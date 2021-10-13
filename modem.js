'use strict';

const MODE_REGISTRY = {
	'bell103': {
		baud: 300,
		space: 1070,
		mark: 1270,
		rxDelay: 0.002351515183, // score: 1.991238538645
	},
	'bell202': {
		baud: 1200,
		space: 2200,
		mark: 1200,
		rxDelay: 0.000445898150, // score: 1.968674618863
	},
}

export class FskModulatorNode extends AudioWorkletNode {
	constructor(params) {
		if (!params.context) {
			throw new Error("No context given");
		}

		const fskParams = MODE_REGISTRY[params.mode];
		if (!fskParams) {
			throw new Error(`Invalid mode ${mode}`);
		}

		const data = params.data;
		if (!data) {
			throw new Error("No data to send");
		}
		const bytes = new Uint8Array(data);

		super(params.context, 'fsk-modulator', {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			channelCount: 1,
			channelCountMode: 'explicit',
		});

		this.port.onmessage = event => {
			if (params.onfinished) {
				params.onfinished();
			}
		}

		this.port.start();
		this.port.postMessage({
			fskParams: fskParams,
			bytes: bytes,
			preamble: params.preamble || 1,
			tail: params.tail || 0.5,
		});
	}
}

export class FskDemodulatorNode extends AudioWorkletNode {
	constructor(params) {
		if (!params.context) {
			console.log(params);
			throw new Error("No context given");
		}

		const fskParams = MODE_REGISTRY[params.mode];
		if (!fskParams) {
			throw new Error(`Invalid mode ${mode}`);
		}

		super(params.context, 'fsk-demodulator', {
			numberOfInputs: 1,
			numberOfOutputs: 0,
			channelCount: 1,
			channelCountMode: 'explicit',
		});

		this.onmessage = params.onmessage;

		this.port.onmessage = event => {
			if (this.onmessage) {
				this.onmessage(event.data);
			}
		}
		this.port.start();
		this.port.postMessage({
			fskParams: fskParams
		});
	}
}
