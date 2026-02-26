export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.log('FocusTab installed', new Date().toISOString());
  });
});
