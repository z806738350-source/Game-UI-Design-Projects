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
  render(<Dropdown value="alpha" options={baseOptions} onChange={onChange} ariaLabel="选择面板" {...props} />);
  const combobox = screen.getByRole('combobox') as HTMLElement;
  return { onChange, combobox };
}

const activeOptionId = (combobox: HTMLElement) => combobox.getAttribute('aria-activedescendant');
const activeLabel = () => document.querySelector('.dropdown-option.is-active span:last-child')?.textContent;

describe('Dropdown 键盘与 ARIA（WAI-ARIA select-only combobox 模式）', () => {
  it('触发元素是 role=combobox 容器，携带 listbox ARIA 语义，展开后指向菜单', async () => {
    const user = userEvent.setup();
    const { combobox } = setup({ ariaLabel: '选择面板' });
    expect(combobox.tagName).not.toBe('BUTTON');
    expect(combobox.getAttribute('aria-haspopup')).toBe('listbox');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
    expect(combobox.getAttribute('aria-controls')).toBeTruthy();
    await user.click(combobox);
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('listbox');
    expect(menu.id).toBe(combobox.getAttribute('aria-controls'));
    expect(screen.getByRole('listbox', { name: '选择面板' })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('aria-activedescendant 只出现在 combobox 上，并随活动项变化、关闭后移除', async () => {
    const user = userEvent.setup();
    const { combobox } = setup();
    expect(activeOptionId(combobox)).toBeNull();
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    const first = activeOptionId(combobox);
    expect(first).toBeTruthy();
    expect(document.getElementById(first!)?.textContent).toContain('Alpha 面板');
    // 活动后代只挂在 combobox 上，listbox 自身不重复携带
    expect(screen.getByRole('listbox').getAttribute('aria-activedescendant')).toBeNull();
    await user.keyboard('{ArrowDown}');
    expect(activeOptionId(combobox)).not.toBe(first);
    await user.keyboard('{Escape}');
    expect(activeOptionId(combobox)).toBeNull();
  });

  it('ariaLabel 成为 Accessible Name，可用角色+名称定位', () => {
    setup({ ariaLabel: '选择面板' });
    expect(screen.getByRole('combobox', { name: '选择面板' })).toBeTruthy();
  });

  it('展开后弹出 listbox 继承同一 Accessible Name（ariaLabel 路径）', async () => {
    const user = userEvent.setup();
    const { combobox } = setup({ ariaLabel: '选择面板' });
    await user.click(combobox);
    expect(screen.getByRole('listbox', { name: '选择面板' })).toBeTruthy();
  });

  it('展开后弹出 listbox 继承字段上下文标签（ariaLabelledBy 路径，优先于 aria-label）', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <span id="listbox-field-label">继承强度字段</span>
        <Dropdown value="alpha" options={baseOptions} onChange={vi.fn()} ariaLabel="被覆盖的名称" ariaLabelledBy="listbox-field-label" />
      </div>
    );
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox', { name: '继承强度字段' })).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: '被覆盖的名称' })).toBeNull();
  });

  it('ariaLabelledBy 成为 Accessible Name，且优先于 aria-label', () => {
    render(
      <div>
        <span id="field-label">继承强度字段</span>
        <Dropdown value="alpha" options={baseOptions} onChange={vi.fn()} ariaLabel="被覆盖的名称" ariaLabelledBy="field-label" />
      </div>
    );
    expect(screen.getByRole('combobox', { name: '继承强度字段' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: '被覆盖的名称' })).toBeNull();
  });

  it('aria-labelledby 支持多引用拼接（字段名 + 控件名），Binding 行三个 combobox 名称互不相同', async () => {
    render(
      <fieldset>
        <legend id="legend-confirm">确认按钮（角色：primary-action）</legend>
        <span id="confirm-component-label">组件</span>
        <Dropdown value="alpha" options={baseOptions} onChange={vi.fn()} ariaLabelledBy="confirm-component-label legend-confirm" />
        <span id="confirm-state-label">状态</span>
        <Dropdown value="alpha" options={baseOptions} onChange={vi.fn()} ariaLabelledBy="confirm-state-label legend-confirm" />
        <span id="confirm-font-label">字体角色</span>
        <Dropdown value="alpha" options={baseOptions} onChange={vi.fn()} ariaLabelledBy="confirm-font-label legend-confirm" />
      </fieldset>
    );
    expect(screen.getByRole('combobox', { name: '组件 确认按钮（角色：primary-action）' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '状态 确认按钮（角色：primary-action）' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '字体角色 确认按钮（角色：primary-action）' })).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    // 展开后弹出 listbox 必须继承同一字段上下文名称（PR#25 审核 Major-01 收口）
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: '组件 确认按钮（角色：primary-action）' }));
    expect(screen.getByRole('listbox', { name: '组件 确认按钮（角色：primary-action）' })).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: '组件 确认按钮（角色：primary-action）' }));
    await user.click(screen.getByRole('combobox', { name: '状态 确认按钮（角色：primary-action）' }));
    expect(screen.getByRole('listbox', { name: '状态 确认按钮（角色：primary-action）' })).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: '状态 确认按钮（角色：primary-action）' }));
    await user.click(screen.getByRole('combobox', { name: '字体角色 确认按钮（角色：primary-action）' }));
    expect(screen.getByRole('listbox', { name: '字体角色 确认按钮（角色：primary-action）' })).toBeTruthy();
  });

  it('开发态缺少 ariaLabel/ariaLabelledBy 时输出一次警告（占位文本不构成名称）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { unmount } = render(<Dropdown value="alpha" options={baseOptions} onChange={vi.fn()} />);
      expect(warn).toHaveBeenCalledWith('Dropdown requires ariaLabel or ariaLabelledBy');
      unmount();
      warn.mockClear();
      render(<Dropdown value="alpha" options={baseOptions} onChange={vi.fn()} ariaLabel="选择面板" />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('选项 ARIA：aria-selected 标记当前值，禁用项带 aria-disabled', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('combobox'));
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-disabled')).toBe('true');
    expect(options[2].getAttribute('aria-selected')).toBe('false');
    expect(options[2].getAttribute('aria-disabled')).toBeNull();
  });

  it('ArrowDown 关闭时打开并定位当前值，打开后移动活动项', async () => {
    const user = userEvent.setup();
    const { combobox } = setup();
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(activeLabel()).toBe('Alpha 面板');
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toBe('Gamma 面板');
  });

  it('ArrowUp 关闭时打开并定位当前值，打开后反向移动并回绕', async () => {
    const user = userEvent.setup();
    const { combobox } = setup();
    combobox.focus();
    await user.keyboard('{ArrowUp}');
    expect(activeLabel()).toBe('Alpha 面板');
    await user.keyboard('{ArrowUp}');
    expect(activeLabel()).toBe('Delta 面板');
  });

  it('方向键与 Home/End 跳过禁用项', async () => {
    const user = userEvent.setup();
    const { combobox } = setup({ value: 'alpha' });
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    // Alpha → 跳过禁用的 Beta → Gamma
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toBe('Gamma 面板');
    await user.keyboard('{End}');
    expect(activeLabel()).toBe('Delta 面板');
    await user.keyboard('{Home}');
    expect(activeLabel()).toBe('Alpha 面板');
  });

  it('Enter 选择活动项：触发 onChange、关闭菜单、焦点恢复 combobox', async () => {
    const user = userEvent.setup();
    const { onChange, combobox } = setup();
    combobox.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('gamma');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(combobox);
  });

  it('Space 开合与选择都只由键盘处理驱动，不会重复触发', async () => {
    const user = userEvent.setup();
    const { onChange, combobox } = setup();
    combobox.focus();
    await user.keyboard(' {ArrowDown} ');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('gamma');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('禁用项不可通过键盘 Enter 选中', async () => {
    const user = userEvent.setup();
    const { onChange, combobox } = setup();
    combobox.focus();
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
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Beta 面板'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('Escape 关闭菜单并保持焦点在 combobox 上', async () => {
    const user = userEvent.setup();
    const { combobox } = setup();
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(combobox);
  });

  it('Tab 关闭菜单并正常离开焦点', async () => {
    const user = userEvent.setup();
    const { combobox } = setup();
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).not.toBe(combobox);
  });

  it('typeahead：输入字母前缀定位匹配项，600ms 内连续输入可累积', async () => {
    const user = userEvent.setup();
    const { combobox } = setup();
    combobox.focus();
    await user.keyboard('g');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(activeLabel()).toBe('Gamma 面板');
    await user.keyboard('{Escape}');
    await user.keyboard('de');
    expect(activeLabel()).toBe('Delta 面板');
  });

  it('当前 value 不在选项中时，ArrowDown 定位第一个可用项', async () => {
    const user = userEvent.setup();
    const { combobox } = setup({ value: 'missing' });
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    expect(activeLabel()).toBe('Alpha 面板');
  });

  it('空列表：键盘与点击都打开空态提示，Enter 关闭且不触发 onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Dropdown value="" options={[]} onChange={onChange} ariaLabel="选择面板" placeholder="请选择" />);
    const combobox = screen.getByRole('combobox');
    combobox.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox').textContent).toContain('无可选项');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(combobox);
    expect(screen.getByRole('listbox').textContent).toContain('无可选项');
  });

  it('长文本选项渲染 title 提示且可正常选择', async () => {
    const user = userEvent.setup();
    const longLabel = '一个非常非常长的选项名称用于验证省略号与悬浮提示是否同时存在';
    const onChange = vi.fn();
    render(<Dropdown value="" options={[{ value: 'long', label: longLabel }]} onChange={onChange} ariaLabel="选择面板" placeholder="请选择" />);
    const combobox = screen.getByRole('combobox');
    combobox.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('long');
    render(<Dropdown value="long" options={[{ value: 'long', label: longLabel }]} onChange={onChange} ariaLabel="选择面板" />);
    expect(screen.getAllByRole('combobox')[1].textContent).toContain(longLabel);
  });

  it('disabled：tabIndex=-1 且 aria-disabled=true，不进入 Tab 顺序，不响应键盘与点击', async () => {
    const user = userEvent.setup();
    const { combobox } = setup({ disabled: true });
    expect(combobox.getAttribute('tabindex')).toBe('-1');
    expect(combobox.getAttribute('aria-disabled')).toBe('true');
    // 不进入 Tab 顺序：从 document 起点 Tab 不会落在禁用的 combobox 上
    await user.tab();
    expect(document.activeElement).not.toBe(combobox);
    // 程序式聚焦后键盘事件仍被忽略，点击也不展开
    combobox.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(combobox);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('鼠标 hover 同步活动项，点击选项后焦点回到 combobox', async () => {
    const user = userEvent.setup();
    const { onChange, combobox } = setup();
    await user.click(combobox);
    await user.hover(screen.getByText('Delta 面板'));
    expect(activeLabel()).toBe('Delta 面板');
    await user.click(screen.getByText('Gamma 面板'));
    expect(onChange).toHaveBeenCalledWith('gamma');
    expect(document.activeElement).toBe(combobox);
  });
});
