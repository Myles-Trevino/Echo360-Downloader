/*
	Copyright Myles Trevino
	Licensed under the Apache License, Version 2.0
	http://www.apache.org/licenses/LICENSE-2.0
*/


import FS from 'fs';
import Path from 'path';
import Playwright from 'playwright';
import Got from 'got';
import {CookieJar} from 'tough-cookie';
import FFmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import * as M3U8Parser from 'm3u8-parser';


type Stream = {uri: string; index: number; quality: number};

let browser: Playwright.FirefoxBrowser;
let browserPage: Playwright.Page;
const cookieJar = new CookieJar();
let m3u8Uris: string[] = [];

const urlsFile = 'urls.txt';
const outputFolder = 'Output';
const waitTime = 3000; // Milliseconds.


// Saves the stream at the given URI.
async function saveStream(uri: string, m3u8Uri: string, index: number)
{
	// Get the stream data.
	const fileName = uri.replace('.m3u8', '.m4s');
	const streamUrl = m3u8Uri.replace(/s\d+_.*\.m3u8/, fileName);
	const response = await Got(streamUrl, {cookieJar});

	// Save the stream.
	if(!FS.existsSync(outputFolder)) FS.mkdirSync(outputFolder);
	const filePath = `${outputFolder}/${fileName} Stream ${index}`;
	FS.writeFileSync(filePath, response.rawBody);

	return filePath;
}


// Downloads the video at the given URL.
async function downloadVideo(title: string, m3u8Uri: string,
	videoIndex: number, multiple: boolean)
{
	// Get the M3U8.
	const m3u8Response = await Got(m3u8Uri, {cookieJar});
	const m3u8Parser = new M3U8Parser.Parser();
	m3u8Parser.push(m3u8Response.body);
	m3u8Parser.end();
	const parsedM3u8 = m3u8Parser.manifest;

	// Get the best quality streams.
	const playlists = parsedM3u8.playlists;
	let streams: Stream[] = [];

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
	let streamIndex = 1;

	for(const stream of streams)
	{
		console.log(`Downloading stream ${streamIndex} of ${streams.length}...`);
		streamFiles.push(await saveStream(stream.uri, m3u8Uri, streamIndex));
		++streamIndex;
	}

	// Merge the streams.
	console.log('Merging...');

	const ffmpeg = FFmpeg().setFfmpegPath(ffmpegPath);
	for(const file of streamFiles) ffmpeg.input(file);

	await new Promise((resolve) => ffmpeg
		.videoCodec('copy')
		.audioCodec('copy')
		.on('end', resolve)
		.save(`${outputFolder}/${title}${multiple ?
			` - Video ${videoIndex}` : ``}.mp4`));

	// Delete the stream files.
	for(const file of streamFiles) FS.unlinkSync(file);

	console.log('Video downloaded.');
}


// Finds the videos at the given URL and downloads them.
async function downloadVideos(url: string)
{
	// Find the video URLs.
	m3u8Uris = [];
	console.log(`Loading the page...`);
	await browserPage.goto(url);
	console.log(`Waiting for M3U8 responses...`);
	await browserPage.waitForTimeout(waitTime);
	const title = Path.parse(await browserPage.title()).name;

	// Download each video.
	let index = 1;
	const multipleVideos = m3u8Uris.length > 1;

	for(const m3u8Uri of m3u8Uris)
	{
		if(index > 1) console.log('---');
		console.log(`Downloading video ${index} of ${m3u8Uris.length}...`);
		await downloadVideo(title, m3u8Uri, index, multipleVideos);
		++index;
	}
}


// Main.
async function main(): Promise<void>
{
	// Print the launch message.
	console.log
	(
		'Echo360 Video Downloader 2021.4.29\n'+
		'Copyright Myles Trevino\n'+
		'Licensed under the Apache License, Version 2.0\n'+
		'http://www.apache.org/licenses/LICENSE-2.0\n'
	);

	// Initialize Playwright.
	console.log(`Initializing...`);
	browser = await Playwright.firefox.launch();
	browserPage = await browser.newPage();
	console.log(`Initialized.\n`);

	browserPage.on('response', (response) =>
	{
		const m3u8Uri = response.url();
		if((/^.*s\d+_.*\.m3u8?.*$/).test(m3u8Uri)) m3u8Uris.push(m3u8Uri);
	});

	// Parse the URLs.
	let urls = FS.readFileSync(urlsFile, 'utf8')
	.split(/\r?\n/).map(e => e.trim());

	urls = urls.filter(element =>
		/^https:\/\/echo360.*\/media\/.*-.*-.*-.*-.*\/public$/.test(element));

	if(urls.length < 1) throw new Error('No valid URLs were found in the input file. '+
		'URLs must be in the format: https://echo360<TLD>/media/<ID>/public.');

	// For each URL...
	let index = 1;
	for(const url of urls)
	{
		if(index > 1) console.log();
		console.log(`URL ${index} of ${urls.length}: ${url}`);
		await downloadVideos(url);
		++index;
	}

	// Close.
	await browser.close();
	console.log('Done.');
}


main();
