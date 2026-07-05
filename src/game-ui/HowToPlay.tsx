import Modal from '../Modal';

export function HowToPlay({ onDone }: { onDone: () => void }) {
  const steps: [string, string, string][] = [
    ['01', 'Build the grid', 'Pick a tower from the ARSENAL (or press 1-9/0), then click open ground or use the arrow keys and Enter. Towers fire automatically at anything in range.'],
    ['CR', 'Spend your credits', 'Every hull you destroy pays out. Bank it into more towers and upgrades.'],
    ['UP', 'Two upgrade tracks', 'Click a built tower to upgrade it down two paths. After your first campaign win, VETERAN DEPLOY can build and auto-upgrade a fresh tower through tier 4/4 when credits allow.'],
    ['AP', 'Damage types & Exposed', 'Kinetic, energy, blast, and cryo each meet different hull plating. Shred hits add Exposed for 4s, up to 5 stacks: each stack strips resistance and makes all follow-up damage hit harder. Mirror Hulls copy your leading type.'],
    ['CD', 'Commander abilities', 'Q/W/E/R/T/Y/U unlock as you advance: orbital strikes, time dilation, Recalibrate, and more. Use them when the lane is breaking.'],
    ['HP', 'Hold the lane', 'Hostiles that reach the OUT gate cost reactor cores. Lose them all and the lighthouse falls. Press SPACE or LAUNCH to send each wave; 1x/2x/4x sets the pace.'],
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
        <button className="start-btn small" onClick={onDone}>GOT IT &gt;</button>
      </div>
    </Modal>
  );
}
