import type { RosterView } from "../types";
import { inviteStatusLabel, inviteStatusPillClass } from "../labels";

interface RosterPanelProps {
  roster: RosterView | null;
  votedCount: number;
  eligibleCount: number | null;
}

function countsText(votedCount: number, eligibleCount: number | null) {
  return eligibleCount === null
    ? `已投 ${votedCount} 人`
    : `已投 ${votedCount} / ${eligibleCount} 人`;
}

export default function RosterPanel({
  roster,
  votedCount,
  eligibleCount,
}: RosterPanelProps) {
  const shownVoted = roster?.votedCount ?? votedCount;
  const shownEligible = roster?.eligibleCount ?? eligibleCount;

  return (
    <section className="vd-panel" aria-labelledby="vd-roster-title">
      <header className="vd-panel-head">
        <h2 id="vd-roster-title" className="vd-panel-title">
          名单
        </h2>
        <span className="vd-panel-meta">
          {countsText(shownVoted, shownEligible)}
        </span>
      </header>

      {!roster ? (
        <p className="vd-panel-note">名单暂不可用。</p>
      ) : !roster.visible ? (
        <p className="vd-panel-note">
          投票进行中，名单暂不公开，只显示已投人数。
        </p>
      ) : roster.mode === "COUNT_ONLY" ? (
        <p className="vd-panel-note">
          受邀 {roster.count ?? shownEligible ?? 0} 人，投票期间只公开人数。
        </p>
      ) : roster.entries.length === 0 ? (
        <p className="vd-panel-note">名单为空。</p>
      ) : (
        <ul className="vd-roster-list">
          {roster.entries.map((entry, index) => (
            <li className="vd-roster-item" key={index}>
              <span className="vd-roster-name">
                {entry.name ?? "（未绑定用户）"}
              </span>
              <span className="vd-roster-badges">
                {entry.status && (
                  <span className={inviteStatusPillClass(entry.status)}>
                    {inviteStatusLabel(entry.status)}
                  </span>
                )}
                {entry.voted !== undefined && (
                  <span
                    className={`vd-tag${
                      entry.voted ? " vd-tag--voted" : " vd-tag--pending"
                    }`}
                  >
                    {entry.voted ? "已投" : "未投"}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
