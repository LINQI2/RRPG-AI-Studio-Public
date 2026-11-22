export default async function teardown() {
  const root = "http://127.0.0.1:3199";
  try {
    const response = await fetch(root + "/api/session");
    const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
    const session = await response.json();
    await fetch(root + "/api/shutdown", {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/json",
        "X-Studio-CSRF": session.csrf,
      },
      body: "{}",
    });
  } catch {
    /* Server may already have stopped after a test failure. */
  }
}
