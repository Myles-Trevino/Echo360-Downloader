/*
	Copyright Myles Trevino
	Licensed under the Apache License, Version 2.0
	http://www.apache.org/licenses/LICENSE-2.0
*/


import FS from 'fs';
import Path from 'path';
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
async function saveStream(uri, m3u8Url, index)
{
	// Get the stream data.
	const fileName = uri.replace('.m3u8', '.m4s');
	const streamUrl = m3u8Url.replace(/s\d+_.*\.m3u8/, fileName);
	const response = await Got(streamUrl, {cookieJar});

	// Save the stream.
	if(!FS.existsSync(outputFolder)) FS.mkdirSync(outputFolder);
	const filePath = `${outputFolder}/${fileName} Stream ${index}`;
	FS.writeFileSync(filePath, response.rawBody);

	return filePath;
}


// Downloads the given video.
async function downloadVideo(title, m3u8Url, number, multiple)
{
	// Get the M3U8.
	const m3u8Response = await Got(m3u8Url, {cookieJar});
	const m3u8Parser = new M3U8Parser.Parser();
	m3u8Parser.push(m3u8Response.body);
	m3u8Parser.end();
	const parsedM3u8 = m3u8Parser.manifest;

	// Get the best quality streams.
	const playlists = parsedM3u8.playlists;
	let streams = [];

	for(const playlist of playlists)
	{
		const uri =  playlist.uri;
		const index = uri.match(/^s(\d+)q/)[1];
		const quality =  uri.match(/q(\d+)\./)[1];

		let best = true;
		streams = streams.filter((stream) =>
		{
			if(stream.index !== index) return true;
			if(quality < stream.quality){ best = false; return true; }
			return false;
		});

		if(best) streams.push({index, quality, uri});
	}

	// Download the streams.
	const streamFiles = [];
	let index = 1;

	for(const stream of streams)
	{
		console.log(`Downloading stream ${index} of ${streams.length}...`);
		streamFiles.push(await saveStream(stream.uri, m3u8Url, index));
		++index;
	}

	// Merge the streams.
	console.log('Merging...');

	const ffmpeg = new FFmpeg().setFfmpegPath(ffmpegPath);
	for(const file of streamFiles) ffmpeg.input(file);

	await new Promise((resolve) => ffmpeg
		.videoCodec('copy')
		.audioCodec('copy')
		.on('end', resolve)
		.save(`${outputFolder}/${title}${multiple ? ` - Video ${number}` : ``}.mp4`));

	// Delete the stream files.
	for(const file of streamFiles) FS.unlinkSync(file);

	console.log('Video downloaded.');
}


// Downloads the content at the given URL.
async function download(url)
{
	// Get the page.
	const indexResponse = await Got(url, {cookieJar});
	const data = JSON.parse(extract(indexResponse.body,
		`Echo["mediaPlayerApp"]("`, `");`).replace(/\\/g, ''));

	// Parse the title.
	let title = Path.parse(_unescape(extract(
		indexResponse.body, '<title>', '</title>'))).name;

	console.log(`Title: ${title}\n---`);

	// Download each video.
	const videos = Object.values(data.sources).filter(
		(element) => element.hasOwnProperty('source'));

	let index = 1;
	const multipleVideos = videos.length > 1;

	for(const video of videos)
	{
		if(index > 1) console.log('---');
		console.log(`Downloading video ${index} of ${videos.length}...`);
		await downloadVideo(title, video.source, index, multipleVideos);
		++index;
	}
}


// Main.
async function main()
{
	try
	{
		// Print the launch message.
		console.log
		(
			'Echo360 Video Downloader\n'+
			'Copyright Myles Trevino\n'+
			'Licensed under the Apache License, Version 2.0\n'+
			'http://www.apache.org/licenses/LICENSE-2.0\n'
		);

		// Parse the URLs.
		let urls = FS.readFileSync(urlsFile, 'utf8')
			.split(/\r?\n/).map(e => e.trim());

		urls = urls.filter(element =>
			/^https:\/\/echo360.*\/media\/.*\/public$/.test(element));

		if(urls.length < 1) throw new Error('No valid URLs were found in the input file. '+
			'URLs must be in the format: https://echo360<TLD>/media/<ID>/public.');

		// For each URL...
		let index = 1;
		for(const url of urls)
		{
			if(index > 1) console.log();
			console.log(`URL ${index} of ${urls.length}: ${url}`);
			await download(url);
			++index;
		}

		console.log('\nDone.');
	}

	// Handle errors.
	catch(error){ console.log(error.message); }
}


main();
