// TODO(F12.2): OBS browser-source overlay.
export function Overlay({ stageId }: { stageId: string }) {
  return (
    <main className="home">
      <h1>Overlay</h1>
      <p className="muted">{stageId}</p>
    </main>
  );
}
