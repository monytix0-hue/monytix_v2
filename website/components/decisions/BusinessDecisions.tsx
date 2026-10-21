export function BusinessDecisions() {
  return (
    <div className="biz-decisions">
      <div className="biz-head">
        <p>DECISIONS</p>
        <span>2 NEED YOU</span>
      </div>
      <div className="biz-previews">
        <article>
          <span className="biz-icon">
            <img src="/decisions/biz-shield.svg" alt="" width={24} height={24} />
          </span>
          <h3>Increase reserve coverage</h3>
          <p>Reserve coverage is below the 90-day target.</p>
        </article>
        <article>
          <span className="biz-icon">
            <img src="/decisions/biz-shield-2.svg" alt="" width={24} height={24} />
          </span>
          <h3>Review customer concentration</h3>
          <p>Top customer contributes 42% of recent receipts.</p>
        </article>
      </div>
      <button type="button">View Decisions →</button>
    </div>
  );
}
