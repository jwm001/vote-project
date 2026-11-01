import { BrowserRouter, Routes, Route } from "react-router-dom";
import Register from "./pages/Register";
import Login from "./pages/Login";
import AdminReview from "./pages/AdminReview";
import CreateVote from "./pages/CreateVote";
import VoteList from "./pages/VoteList";
import VoteDetail from "./pages/VoteDetail";

function Home() {
  return (
    <div style={{ padding: "20px" }}>
      <h1>投票系统 - 首页</h1>
      <div style={{ marginBottom: "10px" }}>
        <a href="/register">注册</a> | <a href="/login">登录</a> | <a href="/admin/review">管理员审核</a>
      </div>
      <div>
        <a href="/votes">投票列表</a> | <a href="/vote/create">创建投票</a>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/review" element={<AdminReview />} />
        <Route path="/votes" element={<VoteList />} />
        <Route path="/vote/create" element={<CreateVote />} />
        <Route path="/vote/:id" element={<VoteDetail />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

