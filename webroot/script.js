var MODULE_DIR = '/data/adb/modules/vibratorcontroller';
var APPS_FILE = MODULE_DIR + '/apps.txt';

var allApps = [];
var disabledApps = [];
var currentTab = 'disabled';
var showSystemApps = false;
var busy = false;
var callbackSeq = 0;

function bridgeAvailable() {
  return !!(window.ksu && typeof window.ksu.exec === 'function');
}

function runShell(cmd) {
  return new Promise(function (resolve, reject) {
    if (!bridgeAvailable()) {
      reject(new Error('WebUI bridge not found. Open this page from the KernelSU/Magisk manager app.'));
      return;
    }
    var cbName = '__vc_cb_' + (callbackSeq++);
    window[cbName] = function (errno, stdout, stderr) {
      delete window[cbName];
      if (errno === 0) {
        resolve(stdout || '');
      } else {
        reject(new Error(stderr || stdout || ('exit code ' + errno)));
      }
    };
    try {
      window.ksu.exec(cmd, '{}', cbName);
    } catch (e) {
      delete window[cbName];
      reject(e);
    }
  });
}

function toLines(text) {
  return (text || '')
    .split('\n')
    .map(function (l) { return l.replace(/\r$/, '').trim(); })
    .filter(function (l) { return l.length > 0; });
}

function b64encode(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function readAppsFile() {
  return runShell('cat ' + APPS_FILE + ' 2>/dev/null')
    .catch(function () { return ''; })
    .then(toLines);
}

function writeAppsFile(list) {
  var payload = b64encode(list.join('\n'));
  return runShell("echo '" + payload + "' | base64 -d > " + APPS_FILE);
}

function setVibration(pkg, mode) {
  return runShell("cmd appops set '" + pkg + "' VIBRATE " + mode);
}

function fetchInstalledApps() {
  var flag = showSystemApps ? '' : '-3 ';
  return runShell('pm list packages ' + flag + '| sed "s/^package://" | sort').then(toLines);
}

function addApp(pkg) {
  return readAppsFile().then(function (current) {
    if (current.indexOf(pkg) !== -1) return;
    current.push(pkg);
    return writeAppsFile(current)
      .then(function () { return setVibration(pkg, 'ignore'); })
      .then(function () {
        showSnackbar('Vibration disabled for ' + pkg);
        return loadData();
      });
  });
}

function removeApp(pkg) {
  return readAppsFile().then(function (current) {
    var updated = current.filter(function (a) { return a !== pkg; });
    return writeAppsFile(updated)
      .then(function () { return setVibration(pkg, 'allow'); })
      .then(function () {
        showSnackbar('Vibration re-enabled for ' + pkg);
        return loadData();
      });
  });
}

function toggleApp(pkg) {
  if (busy) return;
  busy = true;
  var isDisabled = disabledApps.indexOf(pkg) !== -1;
  var task = isDisabled ? removeApp(pkg) : addApp(pkg);
  task.catch(function (err) {
    showSnackbar('Error: ' + err.message);
  }).then(function () {
    busy = false;
  });
}

function loadData() {
  return Promise.all([fetchInstalledApps(), readAppsFile()])
    .then(function (results) {
      allApps = results[0];
      disabledApps = results[1];
      renderApps();
    })
    .catch(function (err) {
      document.getElementById('appList').innerHTML =
        '<div class="state-view">' +
          '<div class="icon">\u26A0\uFE0F</div>' +
          '<div class="title">Could not load data</div>' +
          '<div class="subtitle">' + escapeHtml(err.message) + '</div>' +
        '</div>';
    });
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function renderApps() {
  var list = document.getElementById('appList');
  var search = document.getElementById('searchInput').value.toLowerCase();

  var apps = currentTab === 'disabled' ? disabledApps : allApps;
  apps = apps.filter(function (app) { return app.toLowerCase().indexOf(search) !== -1; });

  document.getElementById('disabledCount').textContent = disabledApps.length;

  if (apps.length === 0) {
    list.innerHTML =
      '<div class="state-view">' +
        '<div class="icon">\uD83D\uDCED</div>' +
        '<div class="title">' + (currentTab === 'disabled' ? 'No apps disabled yet' : 'No apps found') + '</div>' +
      '</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < apps.length; i++) {
    var app = apps[i];
    var isDisabled = disabledApps.indexOf(app) !== -1;
    var initial = app.charAt(0);
    html +=
      '<div class="app-row">' +
        '<div class="avatar">' + escapeHtml(initial) + '</div>' +
        '<div class="app-info">' +
          '<div class="app-name">' + escapeHtml(app) + '</div>' +
          (isDisabled ? '<span class="app-tag">MUTED</span>' : '') +
        '</div>' +
        '<div class="switch' + (isDisabled ? ' on' : '') + '" data-pkg="' + escapeHtml(app) + '">' +
          '<div class="thumb"></div>' +
        '</div>' +
      '</div>';
  }
  list.innerHTML = html;

  Array.prototype.forEach.call(list.querySelectorAll('.app-row .switch'), function (el) {
    el.addEventListener('click', function () {
      toggleApp(this.getAttribute('data-pkg'));
    });
  });
}

function showSnackbar(message) {
  var existing = document.querySelector('.snackbar');
  if (existing) existing.remove();

  var bar = document.createElement('div');
  bar.className = 'snackbar';
  bar.textContent = message;
  document.body.appendChild(bar);

  setTimeout(function () { bar.remove(); }, 3000);
}

document.getElementById('searchInput').addEventListener('input', renderApps);

Array.prototype.forEach.call(document.querySelectorAll('.segmented button'), function (btn) {
  btn.addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.segmented button'), function (b) {
      b.classList.remove('active');
    });
    this.classList.add('active');
    currentTab = this.getAttribute('data-tab');
    renderApps();
  });
});

document.getElementById('systemAppSwitch').addEventListener('click', function () {
  showSystemApps = !showSystemApps;
  this.classList.toggle('on', showSystemApps);
  loadData();
});

loadData();
