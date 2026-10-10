import type {ReadStream} from 'node:fs';
import type {Readable} from 'node:stream';

export interface MicroCdnClientOptions {
	/** Base URL of the micro-cdn service (no trailing slash). */
	url: string;
}

export interface MicroCdnUploadFileRes {
	/** The upload ID. */
	id: string;
	/** The internal path of the main file for this upload. */
	internalFilePath: string;
	/** The main file type. */
	type: ('image' | 'video' | 'video-stream' | 'unknown');
	/** The total video length in seconds (if it's a video). */
	videoLengthSeconds: number | null | undefined;
	/** Whether this is playback media (e.g. a video or video stream). */
	isPlaybackMedia: boolean;
	/** Whether this is a VR video. */
	isVrVideo: boolean;
	/** The total size in bytes of the upload. */
	sizeBytes: number;
}

export default class MicroCdnClient {
	constructor(opts: MicroCdnClientOptions);
	/** Gets the file metadata. */
	getFileMetadata(accessToken: string, fileId: string): Promise<MicroCdnUploadFileRes>;
	/** Uploads a file stream. */
	uploadFile(accessToken: string, contentStream: (ReadableStream | ReadStream | Readable | File | Blob), contentType: string): Promise<MicroCdnUploadFileRes>;

}
