import React from "react";
export function beijingTime(value: unknown) {
  const date = new Date(typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : typeof value === "string" ? value : NaN);
  return Number.isFinite(date.getTime()) ? {iso:date.toISOString(),text:date.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})} : null;
}
export function BeijingTime({value}:{value:unknown}) {
  const at=beijingTime(value);
  return at?<><time dateTime={at.iso}>{at.text}</time>（北京时间）</>:<>尚未记录</>;
}
