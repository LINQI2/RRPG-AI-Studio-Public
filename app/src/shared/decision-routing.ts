type Row=Record<string,any>;
export function decisionAudience(d:Row):"producer"|"technical"|"unclassified" {
  return d.audience==="producer"||d.audience==="technical"?d.audience:"unclassified";
}
