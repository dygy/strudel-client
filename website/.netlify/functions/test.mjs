export default async (request, context) => {
  return new Response(JSON.stringify({ 
    message: "Test function works!",
    timestamp: new Date().toISOString(),
    url: request.url
  }), {
    status: 200,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
};