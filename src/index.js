"use strct";

import "babel-core/register";
import "babel-polyfill";
import electron from "electron";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import http from "http";
import child_process from 'child_process';
import path from 'path';
import readline from "readline";
import uuidV4 from 'uuid/v4';
import windowStateKeeper from "electron-window-state";
import isRunningInAsar from 'electron-is-running-in-asar';
import os from 'os';

const cpuCount = os.cpus().length;

if (isRunningInAsar())
  ffmpeg.path = ffmpeg.path.replace('app.asar', 'app.asar.unpacked');
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

let movie;

http.createServer((request, response) => {
  if (!movie)
  {
    response.writeHead(404);
    return response.end();
  }

  if (!movie.width) movie.width = movWidth;
  if (!movie.height) movie.height = movWidth;

  response.writeHead(200, {'Content-Type': 'video/webm'});
  const proc = child_process.spawn(ffmpeg.path, [
    '-ss', movie.seek,
    '-i', movie.filename,
    '-s', movie.width + 'x' + movie.height,
    '-f', 'webm',
    "-vcodec", "libvpx",
    "-acodec", "libvorbis",
    "-g", "120",
    "-rc_lookahead", "16",
    "-level", "216",
    "-profile", "0",
    "-qmax", "42",
    "-qmin", "10",
    "-vb", "2M",
    "-pix_fmt", "yuv420p",
    "-deadline", "realtime",
    "-cpu-used", String(cpuCount),
    "-threads", String(cpuCount),
    "-stdin",
    //'-loglevel', 'quiet',
    "pipe:1"]);
  proc.stdout.pipe(response);
  let stats = '';
  readline.createInterface({ input: proc.stderr })
    .on('line', line => {
      if (stats != null)
        stats += line + '\n';
      if (line.indexOf('frame=') == 0) {
        if (stats) {
          movie.created = stats.extract(/creation_time\s+:\s+(\d+-\d+-\d+T\d+:\d+:[\d\.]+\w+)/);
          const m = stats.match(/Stream.+:.+Video:.+(yuv\w+).+, (\d{3,}x\d{3,}).+, (\d{2}\.\d+|\d{2,}) fps/);
          if (m) {
            movie.format = m[1];
            movie.resolution = m[2];
            movie.framerate = m[3];
          }
          movie.duration = stats.extract(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2}),/);
          movie.durationInSeconds = timeToSec(movie.duration);
          mainWindow.webContents.send('movie-stats', movie);
          stats = null;
        }
        movie.time = offsetTime(line.extract(/time=(\d{2}:\d{2}:\d{2}.\d{2})/), movie.seek);
        movie.seconds = timeToSec(movie.time);
        movie.frame = Number(line.extract(/frame=\s+(\d+)/));
        try {
          mainWindow.webContents.send('movie-time', {
            time: movie.time,
            seconds: movie.seconds,
            duration: movie.duration,
            durationInSeconds: movie.durationInSeconds,
            frame: movie.frame });
        } catch (e) {}
      }
    });
  electron.ipcMain.on('seek', (event, seek) => {
    try {
      movie.seek = seek;
      openMovie(movie);
    } catch (e) {
      console.log(e);
    }
  });
  response.on("close", function() {
    proc.kill();
  });
}).listen(port);

// browser accepted a movie drop
electron.ipcMain.on('movie', (event, arg) => openMovie(arg));

String.prototype.extract = function(re) {
  const m = this.match(re);
  if (m) return m[1];
  return null;
}

// start playing
function openMovie(opts) {
  if (opts.seek == null) opts.seek = 0;
  movie = opts;
  let url = 'http://localhost:' + port + '/' + uuidV4();
  mainWindow.webContents.send('movie-url', url);
}

function timeToSec(time) {
  if (typeof time == 'number') return time;
  if (typeof time == 'string') {
    const t = time.match(/(\d{2}):(\d{2}):(\d{2}.\d{2})/);
    if (!t) return Number(time);
    return Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
  }
  return Number(time);
}


function d2(n) { return ('00' + n).slice(-2); }

function secToTime(sec) {
  const h = Math.floor(sec / 3600); sec -= h * 3600;
  const m = Math.floor(sec / 60); sec -= m * 60;
  const s = Math.floor(sec); sec -= s;
  const ss = Math.floor(sec * 100);
  return d2(h) + ':' + d2(m) + ':' + d2(s) + '.' + d2(ss);
}

function offsetTime(time, offset) {
  return secToTime(timeToSec(time) + timeToSec(offset));
}
