import { useEffect, useState } from "react";

interface PendingUser {
  id: string;
  realName: string;
  idNumber: string;
  idCardImages: string[];
  createdAt: string;
}

export default function AdminReview() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPending = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/admin/pending", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/admin/${id}/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        alert("审核通过");
        fetchPending();
      }
    } catch (error) {
      alert("操作失败");
    }
  };

  const handleReject = async (id: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/admin/${id}/reject`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        alert("已拒绝");
        fetchPending();
      }
    } catch (error) {
      alert("操作失败");
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <h2>实名认证审核</h2>
      {users.length === 0 ? (
        <p>暂无待审核用户</p>
      ) : (
        <div>
          {users.map((user) => (
            <div
              key={user.id}
              style={{
                border: "1px solid #ccc",
                padding: "15px",
                marginBottom: "15px",
                borderRadius: "5px",
              }}
            >
              <p>
                <strong>真实姓名：</strong>
                {user.realName}
              </p>
              <p>
                <strong>身份证号：</strong>
                {user.idNumber}
              </p>
              <p>
                <strong>申请时间：</strong>
                {new Date(user.createdAt).toLocaleString()}
              </p>
              <p>
                <strong>身份证照片：</strong>
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {user.idCardImages?.map((img, idx) => (
                  <a key={idx} href={`/${img}`} target="_blank" rel="noopener noreferrer">
                    查看照片 {idx + 1}
                  </a>
                ))}
              </div>
              <div style={{ marginTop: "10px", display: "flex", gap: "10px" }}>
                <button onClick={() => handleApprove(user.id)}>批准</button>
                <button onClick={() => handleReject(user.id)}>拒绝</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
