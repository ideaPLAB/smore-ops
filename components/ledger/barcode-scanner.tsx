'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

interface Props {
  onDetected: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const detectedRef = useRef(false);

  useEffect(() => {
    detectedRef.current = false;
    const reader = new BrowserMultiFormatReader();
    let stopFn: (() => void) | null = null;

    (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (!devices.length) { setErr('카메라를 찾을 수 없습니다'); return; }
        const back = devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[devices.length - 1];

        const controls = await reader.decodeFromVideoDevice(
          back.deviceId,
          videoRef.current!,
          (result) => {
            if (!result || detectedRef.current) return;
            detectedRef.current = true;
            onDetected(result.getText());
          },
        );
        stopFn = () => controls.stop();
      } catch (e) {
        setErr((e as Error).message ?? '카메라 오류');
      }
    })();

    return () => { stopFn?.(); };
  // onDetected는 안정 참조가 아니라서 의존성에서 제외
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ color: '#fff', fontSize: '.92rem', fontWeight: 600 }}>바코드를 카메라 중앙에 맞춰주세요</div>
      {err ? (
        <div style={{ color: '#ff8080', fontSize: '.85rem', textAlign: 'center', padding: '0 24px', lineHeight: 1.7 }}>
          {err}<br />
          <span style={{ color: 'var(--lg-faint)', fontSize: '.8rem' }}>카메라 권한을 허용했는지 확인해 주세요</span>
        </div>
      ) : (
        <div style={{ position: 'relative', width: '90%', maxWidth: 380 }}>
          <video
            ref={videoRef}
            style={{ width: '100%', borderRadius: 14, display: 'block', background: '#111' }}
            autoPlay
            playsInline
            muted
          />
          {/* 스캔 가이드 라인 */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ width: '78%', height: 2, background: 'rgba(249,115,22,.85)', boxShadow: '0 0 10px rgba(249,115,22,.5)', borderRadius: 2 }} />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        style={{ padding: '12px 36px', borderRadius: 999, background: '#fff', border: 'none', fontWeight: 700, fontSize: '.95rem', cursor: 'pointer' }}
      >
        닫기
      </button>
    </div>
  );
}
