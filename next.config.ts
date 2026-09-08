const nextConfig = {
  // The Beta currently keeps its state in the browser, so it can be exported
  // as static files for GitHub Pages while retaining the same user flow.
  output: 'export',
  basePath: process.env.GITHUB_ACTIONS ? '/dispatch-schedule-beta' : '',
};

export default nextConfig;
