import ExpoModulesCore

/**
 The iOS side of the module: sound segments and sleep sounds, with the same function names,
 arguments and results as Android. There is no recording service to run (the audio background
 mode keeps capture alive) and no alarm functions, so ClockAlarm stays unavailable in JS.
 */
public class NightwatchRecordingServiceModule: Module {
  /** Every encoder call runs here, in the order JS made it, off the JS thread. */
  private let encoderQueue = DispatchQueue(label: "app.nightwatch.recordingservice.encoder", autoreleaseFrequency: .workItem)

  /** The sound segment being written; only touched on encoderQueue. */
  private var segment: AacSegmentWriter?

  private let noise = NoisePlayer()

  /** Between start and stop, as Android's service would be; only touched on the JS thread. */
  private var started = false

  public func definition() -> ModuleDefinition {
    Name("NightwatchRecordingService")

    OnCreate {
      PlaybackWhileRecording.enable()
    }

    /**
     Android starts its microphone foreground service here. iOS needs none: the audio background
     mode (from the expo-audio config plugin) keeps capture running with the screen off.
     */
    Function("start") { (_: String, _: String) in
      // Already done in OnCreate; repeated so it is certainly in place before capture starts.
      PlaybackWhileRecording.enable()
      self.started = true
    }

    Function("stop") {
      self.started = false
    }

    Function("isRunning") {
      self.started
    }

    /** Starts a new AAC (.m4a) sound segment at a filesystem path. Returns at once; work is queued. */
    Function("beginSegment") { (path: String, sampleRate: Int, bitrate: Int) in
      self.encoderQueue.async {
        self.segment?.abort()
        self.segment = nil
        do {
          self.segment = try AacSegmentWriter(url: fileURL(path), sampleRate: sampleRate, bitrate: bitrate)
        } catch {
          log.warn("Could not start a sound segment: \(error)")
        }
      }
    }

    /** Appends 16-bit little-endian mono PCM to the open segment. Returns at once; work is queued. */
    Function("appendPcm") { (pcm: Data) in
      self.encoderQueue.async {
        guard let writer = self.segment else {
          return
        }
        do {
          try writer.write(pcm)
        } catch {
          log.warn("Sound segment write failed; dropping it: \(error)")
          writer.abort()
          self.segment = nil
        }
      }
    }

    /** Closes the open segment once everything queued before it is encoded. Resolves its size in bytes (0 if none). */
    AsyncFunction("endSegment") { (promise: Promise) in
      self.encoderQueue.async {
        let writer = self.segment
        self.segment = nil
        let bytes: Int = writer?.finish() ?? 0
        promise.resolve(bytes)
      }
    }

    /** Sleep sounds: plays generated noise ("white", "pink", "brown") for durationS, fading out over the last fadeOutS. */
    Function("startNoise") { (color: String, gain: Double, durationS: Double, fadeOutS: Double) in
      self.noise.start(color: color, gain: Float(gain), durationS: durationS, fadeOutS: fadeOutS)
    }

    AsyncFunction("stopNoise") { (promise: Promise) in
      self.noise.stop {
        promise.resolve()
      }
    }

    Function("isNoisePlaying") {
      self.noise.isPlaying
    }

    OnDestroy {
      self.noise.stop {}
      self.encoderQueue.async {
        self.segment?.abort()
        self.segment = nil
      }
    }
  }
}

/** JS passes a plain filesystem path (see src/native/soundWriter.ts); a file:// URI works too. */
private func fileURL(_ path: String) -> URL {
  if path.hasPrefix("file://"), let url = URL(string: path) {
    return url
  }
  return URL(fileURLWithPath: path)
}
