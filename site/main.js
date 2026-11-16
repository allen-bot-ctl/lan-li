(function () {
  "use strict";

  var REPO = "allen-bot-ctl/lan-li";
  var API_URL = "https://api.github.com/repos/" + REPO + "/releases/latest";
  var RELEASES_URL = "https://github.com/" + REPO + "/releases";
  var LATEST_RELEASE_URL = RELEASES_URL + "/latest";

  var statusEl = document.getElementById("release-status");
  var metaEl = document.getElementById("release-meta");
  var fallbackEl = document.getElementById("release-fallback");
  var heroDownloadEl = document.getElementById("download-latest");
  var cardDownloadEl = document.getElementById("download-latest-card");

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setFallback(message) {
    if (!fallbackEl) return;
    fallbackEl.textContent = message;
    fallbackEl.hidden = false;
  }

  function setMeta(text) {
    if (!metaEl) return;
    metaEl.textContent = text;
    metaEl.hidden = !text;
  }

  function pointDownloads(url, label) {
    [heroDownloadEl, cardDownloadEl].forEach(function (link) {
      if (!link) return;
      link.href = url;
      if (label) link.textContent = label;
    });
  }

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatBytes(bytes) {
    var value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "";
    var units = ["B", "KB", "MB", "GB"];
    var index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    var amount = value / Math.pow(1024, index);
    return amount.toFixed(index === 0 ? 0 : 1) + " " + units[index];
  }

  // Only macOS Intel x64 dmg files are offered. This intentionally rejects
  // .zip, Windows, Linux and macOS arm64 assets even if a release contains them.
  function isMacIntelDmg(name) {
    var lower = String(name || "").toLowerCase();
    return (
      lower.endsWith(".dmg") &&
      /(?:^|[._-])mac(?:[._-]|$)/.test(lower) &&
      /(?:^|[._-])(?:x64|amd64)(?:[._-]|$)/.test(lower)
    );
  }

  function findMacIntelDmg(assets) {
    if (!Array.isArray(assets)) return null;
    for (var index = 0; index < assets.length; index += 1) {
      var asset = assets[index];
      if (asset && asset.name && asset.browser_download_url && isMacIntelDmg(asset.name)) {
        return asset;
      }
    }
    return null;
  }

  function showNoRelease() {
    setStatus("安装包正在发布");
    setMeta("");
    setFallback("还没有可用的最新 Release。请到 Release 页面查看，或从源码构建。");
    pointDownloads(LATEST_RELEASE_URL, "前往最新 Release");
  }

  function showNoMatchingAsset() {
    setStatus("安装包正在发布");
    setMeta("");
    setFallback("最新 Release 暂未包含 macOS Intel（x64）的 .dmg。请稍后再看，或到 Release 页面查看全部文件。");
    pointDownloads(LATEST_RELEASE_URL, "前往最新 Release");
  }

  function showRelease(release) {
    var asset = findMacIntelDmg(release.assets);
    if (!asset) {
      showNoMatchingAsset();
      return;
    }

    var tag = String(release.tag_name || "").trim();
    var date = formatDate(release.published_at || release.created_at);
    var statusParts = [];
    if (tag) statusParts.push("最新版本 " + tag);
    if (date) statusParts.push("发布于 " + date);
    setStatus(statusParts.join(" · ") || "已发布");

    var metaParts = [asset.name];
    var size = formatBytes(asset.size);
    if (size) metaParts.push(size);
    setMeta(metaParts.join(" · "));

    if (fallbackEl) fallbackEl.hidden = true;
    pointDownloads(asset.browser_download_url, "下载 macOS Intel 安装包");
  }

  function showUnavailable() {
    setStatus("安装包正在发布");
    setMeta("");
    setFallback("暂时无法连接 GitHub API 读取版本信息。下载按钮仍会打开最新 Release 页面，也可以从源码构建。");
    pointDownloads(LATEST_RELEASE_URL, "前往最新 Release");
  }

  function loadLatestRelease() {
    if (!window.fetch || !statusEl) return;

    if (navigator.onLine === false) {
      showUnavailable();
      return;
    }

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, 9000)
      : null;

    fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        if (response.status === 404) {
          showNoRelease();
          return null;
        }
        if (!response.ok) throw new Error("GitHub API responded with " + response.status);
        return response.json();
      })
      .then(function (release) {
        if (release) showRelease(release);
      })
      .catch(function () {
        showUnavailable();
      })
      .finally(function () {
        if (timeout) window.clearTimeout(timeout);
      });
  }

  loadLatestRelease();
})();
