// TODO(F08.1): room station — audio input picker and level meter.
export function Station({ stageId }: { stageId: string }) {
  return (
    <main className="home">
      <h1>Room station</h1>
      <p className="muted">{stageId}</p>
    </main>
  );
}
