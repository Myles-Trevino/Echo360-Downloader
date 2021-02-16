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
import _unescape from 'lodash/unescape.js';


const urlsFile = 'urls.txt';
const outputFolder = 'output';
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


// Downloads the video at the given URL.
async function download(url)
{
	// Get the cookies and video data.
	const indexResponse = await Got(url, {cookieJar});
	const data = JSON.parse(extract(indexResponse.body,
		`Echo["mediaPlayerApp"]("`, `");`).replace(/\\/g, ''));

	let title = _unescape(extract(indexResponse.body, '<title>', '</title>'));
	title = title.substring(0, title.lastIndexOf('.'));

	console.log(`Found video with title ${title}...`);

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

	await new Promise((resolve) => new FFmpeg()
		.setFfmpegPath(ffmpegPath)
		.input(videoFilePath)
		.videoCodec('copy')
		.input(audioFilePath)
		.audioCodec('copy')
		.on('end', resolve)
		.save(`${outputFolder}/${title}.mp4`));

	// Delete the stream files.
	FS.unlinkSync(audioFilePath);
	FS.unlinkSync(videoFilePath);
}


// Main.
async function main()
{
	try
	{
		let urls = FS.readFileSync(urlsFile, 'utf8')
			.split(/\r?\n/).map(e => e.trim());

		urls = urls.filter(element =>
			/^https:\/\/echo360.org\/media\/.*\/public$/.test(element));

		if(urls.length < 1) throw new Error('No valid URLs were found in the input file. '+
			'URLs must be in the format: https://echo360.org/media/<id>/public.');

		let index = 1;
		for(const url of urls)
		{
			console.log(`Attempting to download video `+
			`${index} of ${urls.length} from ${url}...`);

			await download(url);
			++index;
		}

		console.log('Done.');
	}

	// Handle errors.
	catch(error){ console.log(error.message); }
}


main();
