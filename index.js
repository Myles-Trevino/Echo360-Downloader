/*
	Copyright Myles Trevino
	Licensed under the Apache License, Version 2.0
	http://www.apache.org/licenses/LICENSE-2.0
*/


import FS from 'fs';
import Got from 'got';
import {CookieJar} from 'tough-cookie';
import * as M3U8Parser from 'm3u8-parser';
import FFmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';


const url = 'https://echo360.org/media/<id>/public'; // The URL of the desired video.
const outputFolder = 'Output';

const ffmpeg = new FFmpeg();
const cookieJar = new CookieJar();


// Extracts a substring from between the two given marker strings.
function extract(source, startMarker, endMarker)
{
	let start = source.indexOf(startMarker);
	if(start < 0) throw new Error('Failed to find the start marker.');
	start += startMarker.length;

	const end = source.indexOf(endMarker, start);
	if(end < 0) throw new Error('Failed to find the end marker.');

	return source.substring(start, end);
}


// Saves the stream contained in the given M3U8 playlist.
async function saveStream(type, playlist, m3u8Url)
{
	// Get the filename.
	// For Echo360, the stream filename corresponds to
	// the playlist filename, so we can substitute it.
	const fileName = playlist.uri.replace('.m3u8', '.m4s');
	console.log(`Downloading the ${type} stream...`);

	// Get the stream data.
	const streamUrl = m3u8Url.replace('s1_av.m3u8', fileName);
	const response = await Got(streamUrl, {cookieJar});

	// Save the stream.
	if(!FS.existsSync(outputFolder)) FS.mkdirSync(outputFolder);
	const filePath = `${outputFolder}/${fileName}`;
	FS.writeFileSync(filePath, response.rawBody);

	return filePath;
}


// Main.
async function main()
{
	try
	{
		// Get the cookies and keys.
		const indexResponse = await Got(url, {cookieJar});
		const data = JSON.parse(extract(indexResponse.body,
			`Echo["mediaPlayerApp"]("`, `");`).replace(/\\/g, ''));

		// Get the M3U8.
		const m3u8Url = data.sources.video1.source;
		const m3u8Response = await Got(m3u8Url, {cookieJar});

		// Parse the M3U8.
		const m3u8Parser = new M3U8Parser.Parser();
		m3u8Parser.push(m3u8Response.body);
		m3u8Parser.end();
		const parsedM3u8 = m3u8Parser.manifest;

		// Download.
		const videoFilePath = await saveStream('video', parsedM3u8.playlists[1], m3u8Url);
		const audioFilePath = await saveStream('audio', parsedM3u8.playlists[2], m3u8Url);

		// Merge the audio and video streams.
		console.log('Merging...');

		await new Promise((resolve) => ffmpeg
			.setFfmpegPath(ffmpegPath)
			.input(videoFilePath)
			.input(audioFilePath)
			.on('end', resolve)
			.save(`${outputFolder}/Output.mp4`));

		// Delete the stream files.
		FS.unlinkSync(audioFilePath);
		FS.unlinkSync(videoFilePath);

		console.log('Done.');
	}

	// Handle errors.
	catch(error){ console.log(error); }
}

main();
