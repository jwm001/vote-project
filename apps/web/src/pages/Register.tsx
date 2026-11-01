import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Register() {
  const [formData, setFormData] = useState({
    realName: "",
    idNumber: "",
    username: "",
    password: "",
  });
  const [files, setFiles] = useState<FileList | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = new FormData();
    data.append("realName", formData.realName);
    data.append("idNumber", formData.idNumber);
    data.append("username", formData.username);
    data.append("password", formData.password);
    if (files) {
      for (let i = 0; i < files.length; i++) {
        data.append("idCardImages", files[i]);
      }
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        body: data,
      });
      if (res.ok) {
        alert("注册成功，等待审核");
        navigate("/login");
      } else {
        alert("注册失败");
      }
    } catch (error) {
      alert("注册失败");
    }
  };

  return (
    <div style={{ maxWidth: "500px", margin: "0 auto", padding: "20px" }}>
      <h2>用户注册</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "10px" }}>
          <label>真实姓名：</label>
          <input
            type="text"
            value={formData.realName}
            onChange={(e) => setFormData({ ...formData, realName: e.target.value })}
            required
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>身份证号：</label>
          <input
            type="text"
            value={formData.idNumber}
            onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
            required
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>用户名：</label>
          <input
            type="text"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>密码：</label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>身份证照片：</label>
          <input
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={(e) => setFiles(e.target.files)}
            required
          />
        </div>
        <button type="submit">注册</button>
      </form>
    </div>
  );
}
