"use strct";

import "babel-core/register";
import "babel-polyfill";
import electron from "electron";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import http from "http";
import child_process from 'child_process';
import uuidV4 from 'uuid/v4';
import windowStateKeeper from "electron-window-state";

console.log(ffmpeg.path, ffmpeg.version);

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const appDir = __dirname + "/../src";

let mainWindow = null;

app.commandLine.appendSwitch('ignore-gpu-blacklist', 'true');
app.commandLine.appendSwitch('enable-gpu-rasterization', 'true');
app.commandLine.appendSwitch('enable-zero-copy', 'true');
app.commandLine.appendSwitch('disable-software-rasterizer', 'true');

// hack for OS X
app.on("window-all-closed", () => {
  if (process.platform != "darwin") {
    app.quit();
  }
});

app.on("ready", async () => {
  let mainWindowState = windowStateKeeper({ defaultWidth: 1200, defaultHeight: 900 });
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    backgroundColor: 'white', show: false
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindowState.manage(mainWindow);
  mainWindow.loadURL(`file://${appDir}/index.html`);
  mainWindow.show();
});

const port = 25641;
const movWidth = 640;
const movHeight = 360;

let streams = {};
const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

http.createServer((request, response) => {
  let possibleGuid = request.url.substr(1).toLowerCase();
  let movie = guidRegex.test(possibleGuid) ? streams[possibleGuid] : null; // FIXME: not bad, but not enough
  if (!movie)
  {
    response.writeHead(404);
    return response.end();
  }

  if (!movie.width) movie.width = movWidth;
  if (!movie.height) movie.height = movWidth;

  response.writeHead(200, {'Content-Type': 'video/webm'});
  const proc = child_process.spawn(ffmpeg.path, [
    '-i', movie.filename,
    '-s', movie.width + 'x' + movie.height,
    '-f', 'webm',
    "-vcodec","libvpx-vp9",
    "-acodec","libvorbis",
    "-g","25",
    "-crf", "30", "-b:v", "2000k",
    "-deadline", "realtime",
    "-cpu-used", "6",
    "pipe:1", // stdout
  ]);
  proc.stderr.on('data', buf => {
    //console.log(buf);
  });
  proc.stdout.pipe(response);
  response.on("close", function() {
    proc.kill();
  });
}).listen(port);

electron.ipcMain.on('movie', (event, arg) => {
  let id = uuidV4();
  streams[id] = arg;
  let url = 'http://localhost:' + port + '/' + id;
  console.log('Mapping ' + url + ' to \"' + arg.filename + '\"');
  event.sender.send('movie-uri', url);
});
