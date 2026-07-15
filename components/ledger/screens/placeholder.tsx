'use client';

// 아직 구현 안 된 화면. 빌드 순서(build_instructions_v2 §6)에 따라 순차 구현.
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="lg-card lg-placeholder">
      <p className="lg-ph-title">{title}</p>
      <p className="lg-ph-sub">이 화면은 아직 구현 전이야. 빌드 순서에 따라 곧 붙일게.</p>
    </div>
  );
}
