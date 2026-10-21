const { contextBridge, ipcRenderer } = require("electron");
const calls = [
  "state",
  "manifest",
  "saveSettings",
  "pickDirectory",
  "pickJava",
  "detectJava",
  "install",
  "repair",
  "loaderVersions",
  "pickPack",
  "resolvePack",
  "pickPackFiles",
  "openPackLink",
  "importPack",
  "launch",
  "cancel",
  "installJava",
  "openFolder",
  "login",
  "cancelLogin",
  "logout",
  "openLink",
  "windowControl",
];
const api = Object.fromEntries(
  calls.map((name) => [
    name,
    (...args) => ipcRenderer.invoke("moss:" + name, ...args),
  ]),
);
api.onEvent = (callback) => {
  const listener = (_, event) => callback(event);
  ipcRenderer.on("moss:event", listener);
  return () => ipcRenderer.removeListener("moss:event", listener);
};
contextBridge.exposeInMainWorld("moss", api);
