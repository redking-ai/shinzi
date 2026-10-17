
export default {
  async fetch(_request: Request): Promise<Response> {
    return Response.json({
      ok: true,
      service: "shinzi-backend",
    });
  },
};
