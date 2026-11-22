import React, { useEffect, useState } from "react";

export function DshActivity({ at }: { at?: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const time = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return <p>最近执行活动：尚无带时间的原生执行事件</p>;
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  const ago = seconds < 10 ? "刚刚" : seconds < 60 ? `${seconds} 秒前`
    : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)} 小时前`
    : `${Math.floor(seconds / 86400)} 天前`;
  return <p title="原生执行事件时间，按本机时区显示；不含传输确认。时间变久仅表示没有新事件，不代表执行失败。">
    最近执行活动：<time dateTime={at!}>{new Date(time).toLocaleString("zh-CN", { hour12: false })}</time>
    {" · "}{ago}（本机时间）
  </p>;
}
