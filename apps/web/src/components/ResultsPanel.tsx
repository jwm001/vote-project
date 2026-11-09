import type { ResultsView, VotePhase } from "../types";
import { phaseLabel } from "../labels";

interface ResultsPanelProps {
  results: ResultsView | null;
  phase: VotePhase;
  votedCount: number;
  eligibleCount: number | null;
}

function countsText(votedCount: number, eligibleCount: number | null) {
  return eligibleCount === null
    ? `已投 ${votedCount} 人`
    : `已投 ${votedCount} / ${eligibleCount} 人`;
}

export default function ResultsPanel({
  results,
  phase,
  votedCount,
  eligibleCount,
}: ResultsPanelProps) {
  const shownVoted = results?.votedCount ?? votedCount;
  const shownEligible = results?.eligibleCount ?? eligibleCount;

  return (
    <section className="vd-panel" aria-labelledby="vd-results-title">
      <header className="vd-panel-head">
        <h2 id="vd-results-title" className="vd-panel-title">
          结果
        </h2>
        <span className="vd-panel-meta">
          {countsText(shownVoted, shownEligible)}
        </span>
      </header>

      {!results || !results.visible ? (
        <p className="vd-panel-note">
          {phase === "ENDED"
            ? "结果暂不可见。"
            : "投票进行中，结果暂不公开，只显示已投人数。"}
        </p>
      ) : (
        <>
          <div className="vd-result-list">
            {results.options.map((option) => (
              <div
                className={`vd-result-row${
                  option.isAbstain ? " vd-result-row--abstain" : ""
                }`}
                key={option.id}
              >
                <div className="vd-result-line">
                  <span className="vd-result-text">
                    {option.text}
                    {option.isAbstain && (
                      <span className="vd-tag">系统选项</span>
                    )}
                  </span>
                  <span className="vd-result-count">
                    {option.count} 票 · {option.percent}%
                  </span>
                </div>
                <div className="vd-result-bar" aria-hidden="true">
                  <span
                    className={`vd-result-fill${
                      option.isAbstain ? " vd-result-fill--abstain" : ""
                    }`}
                    style={{ width: `${Math.min(100, option.percent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="vd-result-summary">
            {results.winner ? (
              <span>
                领先：<strong>{results.winner}</strong>
              </span>
            ) : (
              <span>{results.note ?? "未形成多数"}</span>
            )}
            <span className="vd-panel-meta">
              {phase === "ENDED" ? "已结束" : phaseLabel(phase)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
