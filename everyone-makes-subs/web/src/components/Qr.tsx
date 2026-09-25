import qrcode from 'qrcode-generator';

/** Renders `data` as an inline SVG QR code. Used by the phone/TV/dashboard share views. */
export function Qr({ data, className }: { data: string; className?: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  const svg = qr.createSvgTag({ scalable: true });
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
