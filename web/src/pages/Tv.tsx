// TODO(F12.1): room-screen giant captions + corner QR.
export function Tv({ stageId }: { stageId: string }) {
  return (
    <main className="home">
      <h1>Room screen</h1>
      <p className="muted">{stageId}</p>
    </main>
  );
}
