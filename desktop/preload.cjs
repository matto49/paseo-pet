const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("paseoPetBridge", {
  subscribe(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("paseo-pet:status", listener);
    void ipcRenderer.invoke("paseo-pet:status").then(callback);
    return () => ipcRenderer.removeListener("paseo-pet:status", listener);
  },
  open(url) {
    return ipcRenderer.invoke("paseo-pet:open", url);
  },
  report(data) {
    ipcRenderer.send("paseo-pet:rendered", data);
  },
});
