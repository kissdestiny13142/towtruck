/* WebRTC support
   Note that this relies on parts of the interface located in chat.js and intro.js
   */
define(["jquery", "util", "runner", "ui"], function ($, util, runner, ui) {
  var assert = util.assert;

  var PeerConnection =
    window.mozRTCPeerConnection ||
    window.webkitRTCPeerConnection ||
    window.RTCPeerConnection;

  navigator.getUserMedia = navigator.getUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.msGetUserMedia;

  runner.RTCSupported = !! PeerConnection;

  util.on("ui-ready", function () {
    if (! runner.RTCSupported) {
      $(".towtruck-rtc, [data-activate='towtruck-rtc']").hide();
      return;
    }
    $("#towtruck-mute").click(function () {
      var video = $("#towtruck-video")[0];
      video.muted = ! video.muted;
      if (video.muted) {
        $("#towtruck-mute").text("Unmute");
      } else {
        $("#towtruck-mute").text("Mute");
      }
    });
  });

  function startPicPreview() {
    $("#towtruck-open-pic").show();
    $("#towtruck-open-pic").click(function () {
      $("#towtruck-open-pic").hide();
      $("#towtruck-pic-viewer").hide();
      $("#towtruck-accept-pic").hide();
      $("#towtruck-pic-container").show();
      if (! streaming) {
        startStreaming();
      }
    });

    function close() {
      $("#towtruck-open-pic").show();
      $("#towtruck-pic-container").hide();
    }
    $("#towtruck-pic-cancel").click(close);

    var video = $("#towtruck-pic-preview");
    var pic = $("#towtruck-pic-viewer");
    var streaming = false;
    assert(video.length);

    function startStreaming() {
      navigator.getUserMedia({
          video: true,
          audio: false
        },
        function(stream) {
          if (navigator.mozGetUserMedia) {
            video[0].mozSrcObject = stream;
          } else {
            var vendorURL = window.URL || window.webkitURL;
            video[0].src = vendorURL.createObjectURL(stream);
          }
          video[0].play();
        },
        function(err) {
          // FIXME: should pop up help or something in the case of a user
          // cancel
          console.error("getUserMedia error:", err);
        }
      );
    }

    video.on("canplay", function () {
      // This keeps us from asking for getUserMedia more than once:
      streaming = true;
    });

    $("#towtruck-take-pic").click(function () {
      var height = video[0].clientHeight;
      var width = video[0].clientWidth;
      var canvas = $("<canvas>");
      canvas.css({height: height + "px", width: width + "px"});
      var context = canvas[0].getContext("2d");
      context.drawImage(video[0], 0, 0, width, height);
      var data = canvas[0].toDataURL("image/png");
      // FIXME: for some reason this image is truncated on the bottom,
      // but I don't know why
      pic.attr("src", data).show();
      $("#towtruck-accept-pic").show();
    });

    $("#towtruck-accept-pic").click(function () {
      var imgData = pic.attr("src");
      runner.settings("avatar", imgData);
      runner.send({type: "nickname-update", avatar: imgData});
      close();
      updatePreview();
    });

    function updatePreview() {
      var avatar = runner.settings("avatar");
      if (avatar) {
        $("#towtruck-avatar-view-container").show();
        $("#towtruck-avatar-view").attr("src", avatar);
      } else {
        $("#towtruck-avatar-view-container").hide();
      }
    }

    updatePreview();

  }

  runner.peers.on("add update", function (peer) {
    setupChatInterface();
  });

  function addStream(video, stream) {
    video = $(video)[0];
    if (navigator.mozGetUserMedia) {
      video.mozSrcObject = stream;
    } else {
      var vendorURL = window.URL || window.webkitURL;
      video.src = vendorURL.createObjectURL(stream);
    }
  }

  function setupChatInterface() {
    if (! ui.container) {
      return;
    }
    var supported = false;
    runner.peers.forEach(function (p) {
      if (p.rtcSupported) {
        supported = true;
      }
    });
    if (supported) {
      ui.container.find(".towtruck-start-video").show();
    } else {
      ui.container.find(".towtruck-start-video").hide();
      $("#towtruck-video").hide();
    }
    if (! setupChatInterface.bound) {
      $(".towtruck-start-video").click(startVideo);
      setupChatInterface.bound = true;
    }
  }

  var rtc = {
    connection: null,
    offer: null,
    myOffer: null,
    answer: null,
    myAnswer: null,
    videoWanted: true
  };

  util.on("ui-showing-towtruck-rtc", function () {
    setupRTC();
  });

  runner.messageHandler.on("rtc-offer", function (msg) {
    rtc.offer = msg.offer;
    setDescription(msg.offer, function () {
      ui.activateTab("towtruck-rtc");
      setupRTC();
    });
  });

  runner.messageHandler.on("rtc-answer", function (msg) {
    rtc.answer = msg.answer;
    setDescription(msg.answer, function () {
      setupRTC();
    });
  });

  function startVideo() {
    rtc.videoWanted = true;
    setupRTC();
  }

  function makeConnection(callback) {
    if (rtc.connection) {
      callback(rtc.connection);
      return;
    }
    // FIXME: Chrome demands a configuration parameter here:
    var conn = new PeerConnection();
    conn.onaddstream = function (event) {
      console.log("onaddstream", event);
      console.log("streams", conn.remoteStreams, conn.remoteStreams.length);
      var video = $("#towtruck-video");
      for (var i=0; i<conn.remoteStreams.length; i++) {
        var s = conn.remoteStreams[i];
        addStream(video, s);
      }
      video[0].play();
    };
    var video = $("#towtruck-video-me");
    assert(video.length);
    // FIXME: temporary hack for demo!
    var useVideo = ! runner.isClient;
    navigator.mozGetUserMedia(
      {audio: true, video: useVideo},
      function (stream) {
        addStream(video, stream);
        video[0].play();
        rtc.localStream = stream;
        rtc.connection = conn;
        conn.addStream(stream);
        callback(conn);
      },
      function (error) {
        console.warn("Error in RTC getUserMedia:", error);
      }
    );
  }

  function createAnswer(callback) {
    var conn = rtc.connection;
    assert(conn);
    assert(rtc.offer);
    conn.createAnswer(
      //rtc.offer,
      function (answer) {
        conn.setLocalDescription(
          answer,
          function () {
            callback(answer);
          },
          function (error) {
            console.warn("Error doing RTC setLocalDescription:", error);
          }
        );
      },
      function (error) {
        console.warn("Error doing RTC createAnswer:", error);
      }
    );
  }

  function createOffer(callback) {
    var conn = rtc.connection;
    assert(conn);
    conn.createOffer(
      function (offer) {
        rtc.myOffer = offer;
        conn.setLocalDescription(
          offer,
          function () {
            callback(offer);
          },
          function (error) {
            console.warn("Error doing RTC setLocalDescription:", error);
          }
        );
      },
      function (error) {
        console.warn("Error doing RTC createOffer:", error);
      }
    );
  }

  function setDescription(desc, callback) {
    makeConnection(function (conn) {
      conn.setRemoteDescription(
        desc,
        function () {
          if (callback) {
            callback();
          }
        },
        function (error) {
          console.warn("Error doing RTC setRemoteDescription:", error);
        }
      );
    });
  }

  function setupRTC() {
    var chat = require("chat");
    if (! rtc.videoWanted) {
      if (rtc.offer) {
        chat.addChat("Do you want to talk?  Press (v) to start video", "system");
      }
      return;
    }
    if (rtc.videoWanted && ! rtc.offer) {
      makeConnection(function () {
        createOffer(function (offer) {
          runner.send({
            type: "rtc-offer",
            offer: offer
          });
        });
      });
      return;
    }
    if (rtc.videoWanted && rtc.offer && ! rtc.myAnswer) {
    console.log("sending answer");
      makeConnection(function () {
      console.log("connection created");
        createAnswer(function (answer) {
        console.log("answer created");
          runner.send({
            type: "rtc-answer",
            answer: answer
          });
        });
      });
    }
  }

});