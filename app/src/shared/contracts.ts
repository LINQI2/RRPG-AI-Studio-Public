export const roles = ["planner", "developer"] as const;
export type Role = (typeof roles)[number];
export type Row = Record<string, any>;
export class StudioError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
