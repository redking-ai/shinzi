
export default function handler(
  request: { method?: string },
  response: {
    status: (code: number) => {
      json: (body: object) => void;
    };
  }
) {
  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  return response.status(200).json({
    ok: true,
    service: "shinzi-backend",
  });
}
