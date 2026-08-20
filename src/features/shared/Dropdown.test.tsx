import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dropdown } from './ui';

afterEach(cleanup);

const baseOptions = [
  { value: 'alpha', label: 'Alpha 面板' },
  { value: 'beta', label: 'Beta 面板', disabled: true },
  { value: 'gamma', label: 'Gamma 面板' },
  { value: 'delta', label: 'Delta 面板' }
];

function setup(props: Partial<React.ComponentProps<typeof Dropdown>> = {}) {
  const onChange = vi.fn();
  render(<Dropdown value="alpha" options={baseOptions} onChange={onChange} {...props} />);
  const button = screen.getByRole('button') as HTMLButtonElement;
  return { onChange, button };
}

const activeOptionId = (button: HTMLElement) => button.getAttribute('aria-activedescendant');
const activeLabel = () => document.querySelector('.dropdown-option.is-active span:last-child')?.textContent;

describe('Dropdown 键盘与 ARIA（WAI-ARIA Listbox Button 模式）', () => {
  it('按钮携带 listbox ARIA 语义，展开后指向菜单', async () => {
    const user = userEvent.setup();
    const { button } = setup({ ariaLabel: '选择面板' });
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeTruthy();
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('listbox');
    expect(menu.id).toBe(button.getAttribute('aria-controls'));
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('选项 ARIA：aria-selected 标记当前值，禁用项带 aria-disabled', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-disabled')).toBe('true');
    expect(options[2].getAttribute('aria-selected')).toBe('false');
    expect(options[2].getAttribute('aria-disabled')).toBeNull();
  });

  it('ArrowDown 关闭时打开并定位当前值，打开后移动活动项', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(activeLabel()).toBe('Alpha 面板');
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toBe('Gamma 面板');
  });

  it('ArrowUp 关闭时打开并定位当前值，打开后反向移动并回绕', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    button.focus();
    await user.keyboard('{ArrowUp}');
    expect(activeLabel()).toBe('Alpha 面板');
    await user.keyboard('{ArrowUp}');
    expect(activeLabel()).toBe('Delta 面板');
  });

  it('方向键与 Home/End 跳过禁用项', async () => {
    const user = userEvent.setup();
    const { button } = setup({ value: 'alpha' });
    button.focus();
    await user.keyboard('{ArrowDown}');
    // Alpha → 跳过禁用的 Beta → Gamma
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toBe('Gamma 面板');
    await user.keyboard('{End}');
    expect(activeLabel()).toBe('Delta 面板');
    await user.keyboard('{Home}');
    expect(activeLabel()).toBe('Alpha 面板');
  });

  it('Enter 选择活动项：触发 onChange、关闭菜单、焦点恢复按钮', async () => {
    const user = userEvent.setup();
    const { onChange, button } = setup();
    button.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('gamma');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Space 选择活动项，且不会因按钮原生激活而重复开合', async () => {
    const user = userEvent.setup();
    const { onChange, button } = setup();
    button.focus();
    await user.keyboard(' {ArrowDown} ');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('gamma');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('禁用项不可通过键盘 Enter 选中', async () => {
    const user = userEvent.setup();
    const { onChange, button } = setup();
    button.focus();
    await user.keyboard('{ArrowDown}');
    // 活动项从 Alpha 移到 Gamma（跳过禁用 Beta），禁用项始终不可成为活动项
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toBe('Gamma 面板');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('gamma');
  });

  it('禁用项不可通过鼠标选中', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('Beta 面板'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('Escape 关闭菜单并保持焦点在按钮上', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Tab 关闭菜单并正常离开焦点', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).not.toBe(button);
  });

  it('typeahead：输入字母前缀定位匹配项，600ms 内连续输入可累积', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    button.focus();
    await user.keyboard('g');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(activeLabel()).toBe('Gamma 面板');
    await user.keyboard('{Escape}');
    await user.keyboard('de');
    expect(activeLabel()).toBe('Delta 面板');
  });

  it('aria-activedescendant 随活动项变化并在关闭后移除', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    expect(activeOptionId(button)).toBeNull();
    button.focus();
    await user.keyboard('{ArrowDown}');
    const first = activeOptionId(button);
    expect(first).toBeTruthy();
    expect(document.getElementById(first!)?.textContent).toContain('Alpha 面板');
    await user.keyboard('{ArrowDown}');
    expect(activeOptionId(button)).not.toBe(first);
    await user.keyboard('{Escape}');
    expect(activeOptionId(button)).toBeNull();
  });

  it('当前 value 不在选项中时，ArrowDown 定位第一个可用项', async () => {
    const user = userEvent.setup();
    const { button } = setup({ value: 'missing' });
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toBe('Alpha 面板');
  });

  it('空列表：键盘与点击都打开空态提示，Enter 关闭且不触发 onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Dropdown value="" options={[]} onChange={onChange} placeholder="请选择" />);
    const button = screen.getByRole('button');
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox').textContent).toContain('无可选项');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(button);
    expect(screen.getByRole('listbox').textContent).toContain('无可选项');
  });

  it('长文本选项渲染 title 提示且可正常选择', async () => {
    const user = userEvent.setup();
    const longLabel = '一个非常非常长的选项名称用于验证省略号与悬浮提示是否同时存在';
    const onChange = vi.fn();
    render(<Dropdown value="" options={[{ value: 'long', label: longLabel }]} onChange={onChange} placeholder="请选择" />);
    const button = screen.getByRole('button');
    button.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('long');
    render(<Dropdown value="long" options={[{ value: 'long', label: longLabel }]} onChange={onChange} />);
    expect(screen.getAllByRole('button')[1].textContent).toContain(longLabel);
  });

  it('disabled 状态下不响应任何键盘与点击', async () => {
    const user = userEvent.setup();
    const { button } = setup({ disabled: true });
    button.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(button.disabled).toBe(true);
  });

  it('鼠标 hover 同步活动项，点击选项后焦点回到按钮', async () => {
    const user = userEvent.setup();
    const { onChange, button } = setup();
    await user.click(button);
    await user.hover(screen.getByText('Delta 面板'));
    expect(activeLabel()).toBe('Delta 面板');
    await user.click(screen.getByText('Gamma 面板'));
    expect(onChange).toHaveBeenCalledWith('gamma');
    expect(document.activeElement).toBe(button);
  });
});
