import { BrowserRouter, Routes, Route } from "react-router-dom";

function Home() {
  return <div>投票系统 - 首页</div>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
