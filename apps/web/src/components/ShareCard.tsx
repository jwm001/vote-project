import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export default function ShareCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const fullUrl = new URL(url, window.location.origin).toString();

  return (
    <div className="share-card">
      <QRCodeSVG value={fullUrl} size={160} />
      <input
        readOnly
        value={fullUrl}
        aria-label="分享链接"
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(fullUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* 老浏览器不支持剪贴板时，用户可手动全选复制 */
          }
        }}
      >
        {copied ? "已复制" : "复制链接"}
      </button>
    </div>
  );
}
