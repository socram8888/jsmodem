'use strict';

import { MODE_REGISTRY } from './registry.js';

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
