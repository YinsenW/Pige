import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

private let protocolVersion = 1
private let helperVersion = "1.0.0"
private let maxRequestBytes = 64 * 1024

private struct HelperRequest: Decodable {
    let schemaVersion: Int
    let requestId: String
    let operation: String
    let inputPath: String?
    let preferredLanguages: [String]?
    let limits: OcrLimits?
}

private struct OcrLimits: Decodable {
    let maxFileBytes: Int
    let maxSourcePixels: Int
    let maxSourceDimension: Int
    let maxDecodedDimension: Int
    let maxFrames: Int
    let maxBlocks: Int
    let maxOutputCharacters: Int
}

private struct ProbeResult: Encodable {
    let available: Bool
    let helperVersion: String
    let protocolVersion: Int
    let platform: String
    let operatingSystemVersion: String
    let engines: [EngineDescriptor]
}

private struct EngineDescriptor: Encodable {
    let id: String
    let revision: String
}

private struct ImageMetadata: Encodable {
    let typeIdentifier: String
    let frameCount: Int
    let sourceWidth: Int
    let sourceHeight: Int
    let decodedWidth: Int
    let decodedHeight: Int
    let downsampled: Bool
}

private struct BoundingBox: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct OcrBlock: Encodable {
    let text: String
    let kind: String
    let confidence: Double
    let boundingBox: BoundingBox
    let languageHints: [String]
    let isTitle: Bool
}

private struct OcrResult: Encodable {
    let engine: String
    let engineVersion: String
    let adapterVersion: String
    let text: String
    let blocks: [OcrBlock]
    let languageHints: [String]
    let confidence: Double?
    let warnings: [String]
    let image: ImageMetadata
}

private struct SuccessResponse: Encodable {
    let schemaVersion: Int
    let requestId: String
    let ok: Bool
    let probe: ProbeResult?
    let result: OcrResult?
}

private struct FailureResponse: Encodable {
    struct Failure: Encodable {
        let code: String
        let message: String
    }

    let schemaVersion: Int
    let requestId: String
    let ok: Bool
    let error: Failure
}

private struct HelperFailure: Error {
    let code: String
    let message: String
}

private struct PreparedImage {
    let image: CGImage
    let metadata: ImageMetadata
}

@main
private struct PigeVisionOCR {
    static func main() async {
        let requestData = FileHandle.standardInput.readDataToEndOfFile()
        guard requestData.count <= maxRequestBytes else {
            writeFailure(requestId: "unknown", code: "ocr.helper.request_too_large", message: "The OCR helper request exceeded its protocol limit.")
            return
        }

        let request: HelperRequest
        do {
            request = try JSONDecoder().decode(HelperRequest.self, from: requestData)
        } catch {
            writeFailure(requestId: "unknown", code: "ocr.helper.invalid_request", message: "The OCR helper request was invalid.")
            return
        }

        guard request.schemaVersion == protocolVersion, isSafeRequestId(request.requestId) else {
            writeFailure(requestId: "unknown", code: "ocr.helper.invalid_protocol", message: "The OCR helper protocol version or request identifier was invalid.")
            return
        }

        do {
            switch request.operation {
            case "probe":
                writeSuccess(requestId: request.requestId, probe: probe(), result: nil)
            case "recognize":
                guard #available(macOS 26.0, *) else {
                    throw HelperFailure(code: "ocr.platform_unsupported", message: "Apple Vision document OCR requires macOS 26 or later.")
                }
                guard let inputPath = request.inputPath, let limits = request.limits else {
                    throw HelperFailure(code: "ocr.helper.invalid_request", message: "The OCR request omitted its input or limits.")
                }
                try validateLimits(limits)
                let prepared = try prepareImage(path: inputPath, limits: limits)
                let result = try await recognize(
                    image: prepared.image,
                    metadata: prepared.metadata,
                    preferredLanguages: normalizeLanguages(request.preferredLanguages ?? []),
                    limits: limits
                )
                writeSuccess(requestId: request.requestId, probe: nil, result: result)
            default:
                throw HelperFailure(code: "ocr.helper.unsupported_operation", message: "The OCR helper operation was not supported.")
            }
        } catch let failure as HelperFailure {
            writeFailure(requestId: request.requestId, code: failure.code, message: failure.message)
        } catch {
            writeFailure(requestId: request.requestId, code: "ocr.helper.failed", message: "The local OCR helper failed.")
        }
    }
}

private func probe() -> ProbeResult {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    let available: Bool
    if #available(macOS 26.0, *) {
        available = true
    } else {
        available = false
    }
    return ProbeResult(
        available: available,
        helperVersion: helperVersion,
        protocolVersion: protocolVersion,
        platform: "macos",
        operatingSystemVersion: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)",
        engines: [
            EngineDescriptor(id: "macos_vision_document", revision: "revision1"),
            EngineDescriptor(id: "macos_vision_text", revision: "revision3")
        ]
    )
}

private func validateLimits(_ limits: OcrLimits) throws {
    let values = [
        limits.maxFileBytes,
        limits.maxSourcePixels,
        limits.maxSourceDimension,
        limits.maxDecodedDimension,
        limits.maxFrames,
        limits.maxBlocks,
        limits.maxOutputCharacters
    ]
    guard values.allSatisfy({ $0 > 0 }),
          limits.maxFileBytes <= 100 * 1024 * 1024,
          limits.maxSourcePixels <= 100_000_000,
          limits.maxSourceDimension <= 32_768,
          limits.maxDecodedDimension <= 8_192,
          limits.maxFrames <= 16,
          limits.maxBlocks <= 50_000,
          limits.maxOutputCharacters <= 2_000_000 else {
        throw HelperFailure(code: "ocr.helper.invalid_limits", message: "The OCR limits were invalid.")
    }
}

private func prepareImage(path: String, limits: OcrLimits) throws -> PreparedImage {
    guard path.hasPrefix("/") else {
        throw HelperFailure(code: "ocr.image.invalid_path", message: "The OCR source path must be absolute.")
    }
    let url = URL(fileURLWithPath: path, isDirectory: false)
    let attributes: [FileAttributeKey: Any]
    do {
        attributes = try FileManager.default.attributesOfItem(atPath: path)
    } catch {
        throw HelperFailure(code: "ocr.image.source_missing", message: "The preserved image source is unavailable.")
    }
    guard attributes[.type] as? FileAttributeType == .typeRegular else {
        throw HelperFailure(code: "ocr.image.not_regular", message: "The OCR source is not a regular file.")
    }
    let fileSize = (attributes[.size] as? NSNumber)?.intValue ?? -1
    guard fileSize >= 0, fileSize <= limits.maxFileBytes else {
        throw HelperFailure(code: "ocr.image.file_too_large", message: "The preserved image exceeds the OCR file-size limit.")
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        throw HelperFailure(code: "ocr.image.invalid", message: "The preserved source is not a readable image.")
    }
    guard let typeIdentifier = CGImageSourceGetType(source) as String?,
          let imageType = UTType(typeIdentifier),
          imageType.conforms(to: .image) else {
        throw HelperFailure(code: "ocr.image.unsupported_format", message: "The preserved source format is not a supported image.")
    }
    let frameCount = CGImageSourceGetCount(source)
    guard frameCount > 0, frameCount <= limits.maxFrames else {
        throw HelperFailure(code: "ocr.image.multiframe_unsupported", message: "The image contains more frames than this OCR adapter supports.")
    }
    guard frameCount == 1 else {
        throw HelperFailure(code: "ocr.image.multiframe_unsupported", message: "Animated or multi-frame images are not supported by this OCR adapter yet.")
    }
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
          let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
          width > 0,
          height > 0 else {
        throw HelperFailure(code: "ocr.image.dimensions_invalid", message: "The image dimensions could not be validated.")
    }
    guard width <= limits.maxSourceDimension,
          height <= limits.maxSourceDimension,
          width <= limits.maxSourcePixels / height else {
        throw HelperFailure(code: "ocr.image.dimensions_too_large", message: "The image dimensions exceed the OCR safety limit.")
    }

    let thumbnailOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: limits.maxDecodedDimension,
        kCGImageSourceShouldCacheImmediately: true
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary) else {
        throw HelperFailure(code: "ocr.image.decode_failed", message: "The image could not be decoded safely for OCR.")
    }
    return PreparedImage(
        image: image,
        metadata: ImageMetadata(
            typeIdentifier: typeIdentifier,
            frameCount: frameCount,
            sourceWidth: width,
            sourceHeight: height,
            decodedWidth: image.width,
            decodedHeight: image.height,
            downsampled: image.width < width || image.height < height
        )
    )
}

@available(macOS 26.0, *)
private func recognize(
    image: CGImage,
    metadata: ImageMetadata,
    preferredLanguages: [Locale.Language],
    limits: OcrLimits
) async throws -> OcrResult {
    var warnings = metadata.downsampled ? ["image_downsampled"] : []
    do {
        var request = RecognizeDocumentsRequest(.revision1)
        request.textRecognitionOptions.automaticallyDetectLanguage = true
        request.textRecognitionOptions.useLanguageCorrection = true
        request.textRecognitionOptions.maximumCandidateCount = 1
        if !preferredLanguages.isEmpty {
            let supported = Set(request.supportedRecognitionLanguages.map(\.minimalIdentifier))
            request.textRecognitionOptions.recognitionLanguages = preferredLanguages.filter {
                supported.contains($0.minimalIdentifier)
            }
        }
        let observations = try await request.perform(on: image)
        let blocks = observations.flatMap { observation in
            observation.document.text.lines.map { line in
                makeBlock(
                    text: line.transcript,
                    confidence: line.confidence,
                    boundingBox: line.boundingBox,
                    languageHints: line.recognitionLanguages.map(\.minimalIdentifier),
                    isTitle: line.isTitle
                )
            }
        }
        if !blocks.isEmpty {
            return boundedResult(
                engine: "macos_vision_document",
                engineVersion: "revision1",
                blocks: blocks,
                metadata: metadata,
                warnings: warnings,
                limits: limits
            )
        }
        warnings.append("document_request_empty_fallback")
    } catch {
        warnings.append("document_request_failed_fallback")
    }

    var request = RecognizeTextRequest(.revision3)
    request.recognitionLevel = .accurate
    request.automaticallyDetectsLanguage = true
    request.usesLanguageCorrection = true
    if !preferredLanguages.isEmpty {
        let supported = Set(request.supportedRecognitionLanguages.map(\.minimalIdentifier))
        request.recognitionLanguages = preferredLanguages.filter { supported.contains($0.minimalIdentifier) }
    }
    let observations: [RecognizedTextObservation]
    do {
        observations = try await request.perform(on: image)
    } catch {
        throw HelperFailure(code: "ocr.vision.failed", message: "Apple Vision could not recognize text in this image.")
    }
    let blocks = observations.map { line in
        makeBlock(
            text: line.transcript,
            confidence: line.confidence,
            boundingBox: line.boundingBox,
            languageHints: line.recognitionLanguages.map(\.minimalIdentifier),
            isTitle: line.isTitle
        )
    }.sorted(by: readingOrder)
    return boundedResult(
        engine: "macos_vision_text",
        engineVersion: "revision3",
        blocks: blocks,
        metadata: metadata,
        warnings: warnings,
        limits: limits
    )
}

@available(macOS 26.0, *)
private func makeBlock(
    text: String,
    confidence: Float,
    boundingBox: NormalizedRect,
    languageHints: [String],
    isTitle: Bool
) -> OcrBlock {
    let rect = boundingBox.cgRect
    return OcrBlock(
        text: normalizeText(text),
        kind: "line",
        confidence: clamp(Double(confidence)),
        boundingBox: BoundingBox(
            x: clamp(Double(rect.origin.x)),
            y: clamp(1.0 - Double(rect.origin.y + rect.height)),
            width: clamp(Double(rect.width)),
            height: clamp(Double(rect.height))
        ),
        languageHints: uniqueStrings(languageHints, limit: 8),
        isTitle: isTitle
    )
}

private func readingOrder(left: OcrBlock, right: OcrBlock) -> Bool {
    let verticalTolerance = max(left.boundingBox.height, right.boundingBox.height) * 0.5
    if abs(left.boundingBox.y - right.boundingBox.y) > verticalTolerance {
        return left.boundingBox.y < right.boundingBox.y
    }
    return left.boundingBox.x < right.boundingBox.x
}

private func boundedResult(
    engine: String,
    engineVersion: String,
    blocks: [OcrBlock],
    metadata: ImageMetadata,
    warnings inputWarnings: [String],
    limits: OcrLimits
) -> OcrResult {
    var warnings = inputWarnings
    let nonEmptyBlocks = blocks.filter { !$0.text.isEmpty }
    let limitedBlocks = Array(nonEmptyBlocks.prefix(limits.maxBlocks))
    if nonEmptyBlocks.count > limitedBlocks.count {
        warnings.append("ocr_blocks_truncated")
    }

    var emittedBlocks: [OcrBlock] = []
    var text = ""
    for block in limitedBlocks {
        let separator = text.isEmpty ? "" : "\n"
        let available = limits.maxOutputCharacters - text.count - separator.count
        if available <= 0 {
            warnings.append("ocr_output_truncated")
            break
        }
        let blockText = block.text.count > available ? String(block.text.prefix(available)) : block.text
        text += separator + blockText
        emittedBlocks.append(OcrBlock(
            text: blockText,
            kind: block.kind,
            confidence: block.confidence,
            boundingBox: block.boundingBox,
            languageHints: block.languageHints,
            isTitle: block.isTitle
        ))
        if blockText.count < block.text.count {
            warnings.append("ocr_output_truncated")
            break
        }
    }

    let confidence = emittedBlocks.isEmpty
        ? nil
        : emittedBlocks.reduce(0.0) { $0 + $1.confidence } / Double(emittedBlocks.count)
    if let confidence, confidence < 0.65 {
        warnings.append("ocr_low_confidence")
    }
    if text.isEmpty {
        warnings.append("ocr_empty_text")
    }
    let languages = uniqueStrings(emittedBlocks.flatMap(\.languageHints), limit: 16)
    return OcrResult(
        engine: engine,
        engineVersion: engineVersion,
        adapterVersion: helperVersion,
        text: text,
        blocks: emittedBlocks,
        languageHints: languages,
        confidence: confidence,
        warnings: uniqueStrings(warnings, limit: 32),
        image: metadata
    )
}

private func normalizeLanguages(_ identifiers: [String]) -> [Locale.Language] {
    let normalized = uniqueStrings(identifiers.map {
        $0.replacingOccurrences(of: "_", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
    }.filter { identifier in
        identifier.range(of: "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$", options: .regularExpression) != nil
    }, limit: 8)
    return normalized.map(Locale.Language.init(identifier:))
}

private func normalizeText(_ text: String) -> String {
    text.replacingOccurrences(of: "\u{0000}", with: "")
        .replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func uniqueStrings(_ values: [String], limit: Int) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for value in values where !value.isEmpty && !seen.contains(value) {
        seen.insert(value)
        result.append(value)
        if result.count >= limit { break }
    }
    return result
}

private func clamp(_ value: Double) -> Double {
    min(1.0, max(0.0, value.isFinite ? value : 0.0))
}

private func isSafeRequestId(_ value: String) -> Bool {
    value.count >= 8 && value.count <= 128 && value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
}

private func writeSuccess(requestId: String, probe: ProbeResult?, result: OcrResult?) {
    writeJson(SuccessResponse(
        schemaVersion: protocolVersion,
        requestId: requestId,
        ok: true,
        probe: probe,
        result: result
    ))
}

private func writeFailure(requestId: String, code: String, message: String) {
    writeJson(FailureResponse(
        schemaVersion: protocolVersion,
        requestId: requestId,
        ok: false,
        error: .init(code: code, message: message)
    ))
}

private func writeJson<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}
