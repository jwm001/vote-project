import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

interface Vote {
  id: string;
  title: string;
  description?: string;
  allowMultiple: boolean;
  startAt: string;
  endAt: string;
  options: Array<{ id: string; text: string; order: number }>;
}

export default function VoteList() {
  const [votes, setVotes] = useState<Vote[]>([]);

  useEffect(() => {
    fetchVotes();
  }, []);

  const fetchVotes = async () => {
    try {
      const res = await fetch("/api/votes");
      if (res.ok) {
        const data = await res.json();
        setVotes(data.votes || []);
      }
    } catch (error) {
      console.error("Failed to fetch votes", error);
    }
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <h2>投票列表</h2>
      <Link to="/vote/create">创建投票</Link>
      <div style={{ marginTop: "20px" }}>
        {votes.map((vote) => (
          <div key={vote.id} style={{ border: "1px solid #ccc", padding: "15px", marginBottom: "10px" }}>
            <h3>{vote.title}</h3>
            <p>{vote.description}</p>
            <p>
              时间：{new Date(vote.startAt).toLocaleString()} - {new Date(vote.endAt).toLocaleString()}
            </p>
            <p>类型：{vote.allowMultiple ? "多选" : "单选"}</p>
            <p>选项数：{vote.options?.length || 0}</p>
            <Link to={`/vote/${vote.id}`}>查看详情</Link>
          </div>
        ))}
        {votes.length === 0 && <p>暂无投票</p>}
      </div>
    </div>
  );
}
