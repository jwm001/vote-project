import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatUtc } from "../format";
import { phaseLabel, phasePillClass } from "../labels";
import type { MyVoteItem, MyVoteParticipated } from "../types";
import "./MyVotes.css";

type LoadState = "loading" | "ready" | "error";

function countsText(vote: MyVoteItem): string {
  if (vote.eligibleCount === null) return `已投 ${vote.votedCount} 人`;
  return `已投 ${vote.votedCount} / ${vote.eligibleCount} 人`;
}

function isParticipant(vote: MyVoteItem): vote is MyVoteParticipated {
  return vote.relation === "PARTICIPANT";
}

export default function MyVotes() {
  const [votes, setVotes] = useState<MyVoteItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [needLogin, setNeedLogin] = useState(
    () => !localStorage.getItem("token")
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({});
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setNeedLogin(true);
      setState("ready");
      return;
    }

    setNeedLogin(false);
    setState("loading");
    setError("");
    let cancelled = false;

    api
      .get<{ votes: MyVoteItem[] }>("/api/votes/my/votes")
      .then((data) => {
        if (cancelled) return;
        setVotes(Array.isArray(data.votes) ? data.votes : []);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem("token");
          setNeedLogin(true);
          setState("ready");
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "加载失败，请检查网络后重试"
        );
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const copyPseudonym = async (text: string, voteId: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      document.body.removeChild(helper);
    }
    setCopiedId(voteId);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedId(null), 1800);
  };

  const downloadPdf = async (voteId: string) => {
    setDownloadingId(voteId);
    setPdfErrors((previous) => {
      if (!previous[voteId]) return previous;
      const next = { ...previous };
      delete next[voteId];
      return next;
    });

    try {
      await api.download(`/api/votes/${voteId}/audit/pdf`, `audit-${voteId}.pdf`);
    } catch (err) {
      setPdfErrors((previous) => ({
        ...previous,
        [voteId]: err instanceof ApiError ? err.message : "PDF 下载失败，请重试",
      }));
    } finally {
      setDownloadingId(null);
    }
  };

  const created = votes.filter((vote) => vote.relation === "CREATOR");
  const participated = votes.filter(isParticipant);

  const renderCard = (vote: MyVoteItem) => {
    const participant = isParticipant(vote) ? vote : null;
    const sequence = participant?.sequenceNumber ?? null;
    const voteKey = `${vote.relation}-${vote.voteId}`;

    return (
      <article className="mv-card" key={voteKey}>
        {sequence !== null && (
          <div className="mv-seq" title="本场全量记录中的排序号">
            <span className="mv-seq-label">No.</span>
            <span className="mv-seq-value">{sequence}</span>
          </div>
        )}

        <div className="mv-body">
          <div className="mv-title-row">
            <Link className="mv-vote-title" to={`/vote/${vote.voteId}`}>
              {vote.voteTitle}
            </Link>
            <span className={phasePillClass(vote.phase)}>
              {phaseLabel(vote.phase)}
            </span>
            <span className="mv-chip">
              {vote.participationMode === "INVITE_ONLY" ? "邀请制" : "公开链接"}
            </span>
            <span className="mv-chip">
              {vote.relation === "CREATOR" ? "我创建的" : "我参与的"}
            </span>
          </div>

          <div className="mv-meta">
            <span className="mv-chip">{vote.allowMultiple ? "多选" : "单选"}</span>
            <span>{countsText(vote)}</span>
            {participant?.submittedAt && (
              <span>🕐 投票于 {formatUtc(participant.submittedAt)}</span>
            )}
          </div>

          {participant && (
            <div className="mv-pseudonym">
              <span className="mv-pseudo-label">匿名假名</span>
              {participant.pseudonym ? (
                <>
                  <code className="mv-pseudo-value">
                    {participant.pseudonym}
                  </code>
                  <button
                    type="button"
                    className="mv-copy"
                    onClick={() =>
                      copyPseudonym(participant.pseudonym!, vote.voteId)
                    }
                  >
                    {copiedId === vote.voteId ? "已复制" : "复制"}
                  </button>
                </>
              ) : (
                <span className="mv-pseudo-value mv-pseudo-value--empty">
                  记录缺失
                </span>
              )}
            </div>
          )}

          {pdfErrors[vote.voteId] && (
            <p className="mv-error" role="alert">
              {pdfErrors[vote.voteId]}
            </p>
          )}
        </div>

        <div className="mv-actions">
          <Link className="mv-btn mv-btn--primary" to={`/vote/${vote.voteId}`}>
            {vote.relation === "CREATOR" ? "进入管理" : "查看详情"}
          </Link>
          {participant && (
            <button
              type="button"
              className="mv-btn mv-btn--ghost"
              onClick={() => downloadPdf(vote.voteId)}
              disabled={downloadingId === vote.voteId}
            >
              {downloadingId === vote.voteId ? "下载中…" : "下载 PDF"}
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div>
      <header className="mv-head">
        <div>
          <h1 className="mv-title">我的投票</h1>
          <p className="mv-sub">
            {state === "ready" && !needLogin
              ? `共 ${votes.length} 场 · 我创建 ${created.length} 场 · 我参与 ${participated.length} 场`
              : "准入实名 · 投票匿名 · 全量可审计"}
          </p>
        </div>
      </header>

      {needLogin && (
        <div className="mv-panel">
          <div className="mv-panel-icon">🔒</div>
          <h2 className="mv-panel-title">请先登录</h2>
          <p className="mv-panel-text">
            登录后可查看你创建的投票、参与的记录、匿名假名与全量记录 PDF。
          </p>
          <Link className="mv-cta" to="/login?redirect=/my-votes">
            去登录
          </Link>
        </div>
      )}

      {!needLogin && state === "loading" && (
        <div className="mv-list" aria-busy="true" aria-label="正在加载投票">
          {[0, 1, 2].map((index) => (
            <div className="mv-skeleton" key={index}>
              <div className="mv-sk mv-sk--seq" />
              <div className="mv-sk-lines">
                <div className="mv-sk mv-sk--title" />
                <div className="mv-sk mv-sk--meta" />
                <div className="mv-sk mv-sk--pseudo" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!needLogin && state === "error" && (
        <div className="mv-panel">
          <div className="mv-panel-icon">⚠️</div>
          <h2 className="mv-panel-title">加载失败</h2>
          <p className="mv-panel-text">{error}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
            重新加载
          </button>
        </div>
      )}

      {!needLogin && state === "ready" && votes.length === 0 && (
        <div className="mv-panel">
          <div className="mv-panel-icon">🗳️</div>
          <h2 className="mv-panel-title">还没有投票</h2>
          <p className="mv-panel-text">
            创建一场投票，或接受邀请参与投票后，记录会出现在这里。
          </p>
          <Link className="mv-cta" to="/">
            回到首页
          </Link>
        </div>
      )}

      {!needLogin && state === "ready" && created.length > 0 && (
        <section className="mv-group" aria-labelledby="mv-created-title">
          <div className="mv-group-head">
            <h2 id="mv-created-title" className="mv-group-title">
              我创建的
            </h2>
            <span className="mv-group-count">{created.length} 场</span>
          </div>
          <div className="mv-list">{created.map(renderCard)}</div>
        </section>
      )}

      {!needLogin && state === "ready" && participated.length > 0 && (
        <section className="mv-group" aria-labelledby="mv-participated-title">
          <div className="mv-group-head">
            <h2 id="mv-participated-title" className="mv-group-title">
              我参与的
            </h2>
            <span className="mv-group-count">{participated.length} 场</span>
          </div>
          <div className="mv-list">{participated.map(renderCard)}</div>
        </section>
      )}

      {!needLogin && state === "ready" && votes.length > 0 && (
        <p className="mv-footnote">
          序号是该场投票全量记录 PDF 中的排序号；本页不展示任何实名信息。
        </p>
      )}
    </div>
  );
}
