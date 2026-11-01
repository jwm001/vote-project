import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

interface Option {
  id: string;
  text: string;
  order: number;
}

interface Vote {
  id: string;
  title: string;
  description?: string;
  allowMultiple: boolean;
  startAt: string;
  endAt: string;
  options: Option[];
}

export default function VoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vote, setVote] = useState<Vote | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchVote();
  }, [id]);

  const fetchVote = async () => {
    try {
      const res = await fetch(`/api/votes/${id}`);
      if (res.ok) {
        const data = await res.json();
        setVote(data.vote);
      }
    } catch (error) {
      console.error("Failed to fetch vote", error);
    }
  };

  const handleSelectOption = (optionId: string) => {
    if (!vote) return;
    if (vote.allowMultiple) {
      if (selectedOptions.includes(optionId)) {
        setSelectedOptions(selectedOptions.filter((o) => o !== optionId));
      } else {
        setSelectedOptions([...selectedOptions, optionId]);
      }
    } else {
      setSelectedOptions([optionId]);
    }
  };

  const handleSubmit = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("请先登录");
      navigate("/login");
      return;
    }

    if (selectedOptions.length === 0) {
      alert("请选择选项");
      return;
    }

    try {
      const res = await fetch(`/api/votes/${id}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ optionIds: selectedOptions }),
      });

      if (res.ok) {
        alert("投票成功，正在下载全量记录PDF...");
        // 强制触发下载全量记录PDF
        try {
          const pdfRes = await fetch(`/api/votes/${id}/audit/pdf`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (pdfRes.ok) {
            const blob = await pdfRes.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `audit-${id}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
          }
        } catch (err) {
          console.error("Failed to download PDF", err);
        }
        navigate("/votes");
      } else {
        const data = await res.json();
        alert(data.error || "投票失败");
      }
    } catch (error) {
      alert("投票失败");
    }
  };

  if (!vote) {
    return <div style={{ padding: "20px" }}>加载中...</div>;
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "20px" }}>
      <h2>{vote.title}</h2>
      <p>{vote.description}</p>
      <p>
        时间：{new Date(vote.startAt).toLocaleString()} - {new Date(vote.endAt).toLocaleString()}
      </p>
      <p>类型：{vote.allowMultiple ? "多选" : "单选"}</p>
      <div style={{ marginTop: "20px" }}>
        <h3>选项</h3>
        {vote.options
          .sort((a, b) => a.order - b.order)
          .map((option) => (
            <div key={option.id} style={{ marginBottom: "10px" }}>
              <label>
                <input
                  type={vote.allowMultiple ? "checkbox" : "radio"}
                  name="voteOption"
                  checked={selectedOptions.includes(option.id)}
                  onChange={() => handleSelectOption(option.id)}
                />
                {option.text}
              </label>
            </div>
          ))}
      </div>
      <button onClick={handleSubmit} style={{ marginTop: "20px", padding: "10px 20px" }}>
        提交投票
      </button>
    </div>
  );
}
