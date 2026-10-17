import AVFoundation
import ExpoModulesCore

/**
 Lets sleep sounds play while the microphone records.

 expo-audio's AudioStream, which records the night, sets the session to the record category each
 time it starts (and again whenever the capture watchdog restarts it), and that category silences
 everything the app plays. Switching to play-and-record once the stream is running will not do:
 it adds output channels to the hardware, which stops the stream's AVAudioEngine, and the
 watchdog's restart would ask for record again.

 So the switch happens at the one moment it is harmless: when the stream asks for record, before
 its engine starts, it gets play-and-record with the same mode (measurement) and options instead,
 plus the speaker as the default output (not the earpiece) and Bluetooth headphones for output
 only, so the microphone is still the phone's own. Nothing else in the app asks for record. If
 the substitute is refused, the original call goes ahead, so recording never depends on this.

 This swaps the implementation of AVAudioSession's setCategory(_:mode:options:), as expo-font
 does for UIFont. It is the smallest change that works while expo-audio offers no option for it
 (checked up to expo-audio 58); drop it if a later version records in play-and-record.
 */
enum PlaybackWhileRecording {
  /** A static let runs once, thread safely, however often enable() is called. */
  private static let swapped: Bool = {
    let original = NSSelectorFromString("setCategory:mode:options:error:")
    let substitute = #selector(AVAudioSession.nightwatch_setCategory(_:mode:options:))
    guard let originalMethod = class_getInstanceMethod(AVAudioSession.self, original),
          let substituteMethod = class_getInstanceMethod(AVAudioSession.self, substitute) else {
      log.error("Sleep sounds cannot play while recording: setCategory(_:mode:options:) was not found")
      return false
    }
    method_exchangeImplementations(originalMethod, substituteMethod)
    return true
  }()

  static func enable() {
    _ = swapped
  }
}

extension AVAudioSession {
  /**
   Runs in place of setCategory(_:mode:options:) once the implementations are swapped; calling
   itself then calls the original.
   */
  @objc dynamic func nightwatch_setCategory(
    _ category: AVAudioSession.Category,
    mode: AVAudioSession.Mode,
    options: AVAudioSession.CategoryOptions
  ) throws {
    if category == .record {
      do {
        try nightwatch_setCategory(.playAndRecord, mode: mode, options: options.union([.defaultToSpeaker, .allowBluetoothA2DP]))
        return
      } catch {
        log.warn("Recording without sleep sounds; play-and-record was refused: \(error)")
      }
    }
    try nightwatch_setCategory(category, mode: mode, options: options)
  }
}
