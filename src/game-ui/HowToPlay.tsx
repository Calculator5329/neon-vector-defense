import Modal from '../Modal';

export function HowToPlay({ onDone }: { onDone: () => void }) {
  const steps: [string, string, string][] = [
    ['🎯', 'Build the grid', 'Pick a tower from the ARSENAL (or press 1–9/0), then click open ground beside the lane. Towers fire automatically at anything in range.'],
    ['⌬', 'Spend your credits', 'Every hull you destroy pays out. Bank it into more towers and upgrades.'],
    ['▲', 'Two upgrade tracks', 'Click a built tower to upgrade it down two paths. The final two tiers are expensive — and devastating — but you must COMMIT to one track to buy them.'],
    ['⚡', 'Commander abilities', 'Q/W/E/R/T/Y unlock as you advance — orbital strikes, time dilation, and more. Use them when the lane is breaking.'],
    ['⬢', 'Hold the lane', 'Hostiles that reach the OUT gate cost reactor cores. Lose them all and the lighthouse falls. Press SPACE or LAUNCH to send each wave; 1×/2×/4× sets the pace.'],
  ];
  return (
    <Modal onClose={onDone} boxClass="overlay-box howto" labelledBy="howto-title" testId="tutorial-overlay">
      <h2 id="howto-title" style={{ color: 'var(--accent)' }}>HOW TO HOLD THE LANE</h2>
      <div className="howto-steps">
        {steps.map(([icon, title, body]) => (
          <div key={title} className="howto-step">
            <span className="howto-icon">{icon}</span>
            <div>
              <div className="howto-title">{title}</div>
              <div className="howto-body">{body}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="overlay-btns">
        <button className="start-btn small" onClick={onDone}>GOT IT ▸</button>
      </div>
    </Modal>
  );
}
