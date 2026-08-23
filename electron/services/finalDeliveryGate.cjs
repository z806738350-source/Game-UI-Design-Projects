const { ERROR_CODES } = require('./errorCodes.cjs');
const { assertFinalApprovalForExport, verifyCompositionOutput } = require('./compositionRenderer.cjs');

// WEB-DELIVERY-01：最终成图导出是跨系统的正式交付边界，桌面 IPC 与 Web
// 路由必须执行同一套门禁，任何一端单独实现都会再次出现旁路。检查顺序：
// 1. Fidelity 新鲜度（内容证据链：同一份 Manifest id + 同一张 PNG hash）；
// 2. 最终批准（Composition Manifest approved）与视觉绑定重验；
// 3. Output 像素级校验（文件存在、hash、尺寸）。
// 抛出的错误携带 status: 409 供 Web 路由映射；桌面端只消费 message/code。
async function assertFinalDeliveryReady({ project, projectPath }) {
  const artifacts = project?.artifacts || {};
  const output = artifacts.compositionOutput;
  const manifest = artifacts.compositionManifest;
  const fidelity = artifacts.fidelityReport;
  // AUD-10：新鲜度不能用存储版本号对齐——批准保存也会单调 bump Manifest
  // 版本。改用内容证据链：Fidelity 验证的是同一份 Manifest（id）与同一张
  // PNG（hash），且当前 Manifest 仍引用这张 PNG。
  const fidelityFresh = Boolean(fidelity && fidelity.status === 'passed'
    && fidelity.source?.composition_manifest === manifest?.id
    && fidelity.source?.composition_output_hash === output?.hash
    && manifest?.output?.hash === output?.hash);
  if (!fidelityFresh) {
    throw Object.assign(
      new Error('无法导出最终成图：需要先通过针对当前合成结果的 Final Fidelity 检查。'),
      { code: ERROR_CODES.FINAL_EXPORT_BLOCKED, status: 409 }
    );
  }
  try {
    // 交付边界：最终批准必须先于导出；同时重验 Manifest 是否仍对应当前
    // Visual Results 评审（视觉变化后旧交付链不得外流）。
    assertFinalApprovalForExport(project);
  } catch (error) {
    throw Object.assign(error, { status: 409 });
  }
  const verification = await verifyCompositionOutput(projectPath, output, { requireFinal: true });
  if (!verification.passed) {
    throw Object.assign(
      new Error(`无法导出最终成图：${verification.issues.map((item) => item.message).join('；')}`),
      { code: ERROR_CODES.FINAL_EXPORT_BLOCKED, status: 409 }
    );
  }
  return { verification };
}

module.exports = { assertFinalDeliveryReady };
