import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatUtc } from "../format";
import type { HallVoteItem } from "../types";
import "./Hall.css";

type LoadState = "loading" | "ready" | "error";
type Gate = "ok" | "needLogin" | "pending";

export default function Hall() {
  const [votes, setVotes] = useState<HallVoteItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [gate, setGate] = useState<Gate>(() =>
    localStorage.getItem("token") ? "ok" : "needLogin"
  );
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setGate("needLogin");
      setState("ready");
      return;
    }

    setGate("ok");
    setState("loading");
    setError("");
    let cancelled = false;

    api
      .get<{ votes: HallVoteItem[] }>("/api/votes/hall")
      .then((data) => {
        if (cancelled) return;
        setVotes(Array.isArray(data.votes) ? data.votes : []);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem("token");
          setGate("needLogin");
          setState("ready");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setGate("pending");
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

  const renderCard = (vote: HallVoteItem) => (
    <article className="hall-card" key={vote.voteId}>
      <div className="hall-body">
        <div className="hall-title-row">
          <Link className="hall-vote-title" to={`/vote/${vote.voteId}`}>
            {vote.title}
          </Link>
          {vote.isCreator && <span className="hall-chip">我创建的</span>}
          {vote.hasVoted && (
            <span className="hall-chip hall-chip--voted">已投</span>
          )}
        </div>

        {vote.description && <p className="hall-desc">{vote.description}</p>}

        <div className="hall-meta">
          <span className="hall-chip">{vote.allowMultiple ? "多选" : "单选"}</span>
          <span>发起人 {vote.creatorUsername || "—"}</span>
          <span>🕐 截止 {formatUtc(vote.endAt)}</span>
          <span>已投 {vote.votedCount} 人</span>
        </div>
      </div>

      <div className="hall-actions">
        <Link className="hall-btn" to={`/vote/${vote.voteId}`}>
          {vote.isCreator ? "进入管理" : vote.hasVoted ? "查看详情" : "去投票"}
        </Link>
      </div>
    </article>
  );

  return (
    <div>
      <header className="hall-head">
        <div>
          <h1 className="hall-title">投票大厅</h1>
          <p className="hall-sub">所有已核验用户都能参与的公开投票</p>
        </div>
      </header>

      {gate === "needLogin" && (
        <div className="hall-panel">
          <div className="hall-panel-icon">🔒</div>
          <h2 className="hall-panel-title">请先登录</h2>
          <p className="hall-panel-text">
            登录后可浏览所有公开投票，直接参与，不用等别人发链接。
          </p>
          <Link className="hall-cta" to="/login?redirect=/hall">
            去登录
          </Link>
        </div>
      )}

      {gate === "pending" && (
        <div className="hall-panel">
          <div className="hall-panel-icon">⏳</div>
          <h2 className="hall-panel-title">完成实名核验后即可浏览投票大厅</h2>
          <p className="hall-panel-text">
            只有核验通过的账号才能参与投票，先去账户页看看核验状态。
          </p>
          <Link className="hall-cta" to="/account">
            查看账户
          </Link>
        </div>
      )}

      {gate === "ok" && state === "loading" && (
        <div className="hall-list" aria-busy="true" aria-label="正在加载投票">
          {[0, 1, 2].map((index) => (
            <div className="hall-skeleton" key={index}>
              <div className="hall-sk-lines">
                <div className="hall-sk hall-sk--title" />
                <div className="hall-sk hall-sk--meta" />
                <div className="hall-sk hall-sk--meta hall-sk--short" />
              </div>
            </div>
          ))}
        </div>
      )}

      {gate === "ok" && state === "error" && (
        <div className="hall-panel">
          <div className="hall-panel-icon">⚠️</div>
          <h2 className="hall-panel-title">加载失败</h2>
          <p className="hall-panel-text">{error}</p>
          <button
            type="button"
            className="hall-cta"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            重新加载
          </button>
        </div>
      )}

      {gate === "ok" && state === "ready" && votes.length === 0 && (
        <div className="hall-panel">
          <div className="hall-panel-icon">🗳️</div>
          <h2 className="hall-panel-title">大厅里还没有公开投票</h2>
          <p className="hall-panel-text">
            创建一场公开链接投票并勾选「在投票大厅公开」，它就会出现在这里。
          </p>
          <Link className="hall-cta" to="/create">
            创建投票
          </Link>
        </div>
      )}

      {gate === "ok" && state === "ready" && votes.length > 0 && (
        <div className="hall-list">{votes.map(renderCard)}</div>
      )}
    </div>
  );
}
