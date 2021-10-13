'use strict';

class UartTransmitter {
	constructor(port, config) {
		this.port = port;

		// FIFO for messages to be send
		this.queue = new Array();

		// Preamble and tail
		this.preamble = 0;
		this.tail = 0;
	}

	schedule(id, bytes) {
		this.queue.push({
			id: id,
			bytes: bytes
		});
	}

	nextSymbol() {
		// If no transmission is going on...
		if (!this.current) {
			// Attempt to extract a queued one
			this.current = this.queue.shift();

			// If it failed, abort
			if (!this.current) {
				return null;
			}

			// Prepare new transmission
			this.symbolCount = 0;

			// Execute preamble
			return 'preamble';
		}

		/*
		 * Calculate byte and bit index.
		 *
		 * We have to divide by 10 because for every 8-bit byte we also have to send one start
		 * bit and one stop bit.
		 */
		const byteIdx = (this.symbolCount / 10) | 0;
		const bitIdx = this.symbolCount % 10 - 1;

		// If we reached the end of the current message
		if (byteIdx >= this.current.bytes.length) {
			// Notify remote we're done with this message
			this.port.postMessage({
				id: this.current.id
			});

			// Reset current (so in next iteration a new one is pulled from the FIFO)
			this.current = null;

			// Then execute tail
			return 'tail';
		}

		let symbol;
		switch (bitIdx) {
			case -1:
				// Execute start bit
				symbol = 0;
				break;

			default:
				// Extract actual bit
				symbol = (this.current.bytes[byteIdx] >> bitIdx) & 1;
				break;

			case 8:
				// Execute stop bit
				symbol = 1;
				break;
		}

		// Increment symbol position
		this.symbolCount++;

		return symbol ? 'mark' : 'space';
	}
}

class FskModulatorProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		this.config = null;
		this.transmitter = new UartTransmitter(this.port);

		this.currentSample = 0;
		this.symbolEnd = 0;
		this.currentPhase = 0;

		this.port.onmessage = msg => {
			const data = msg.data;
			if (data.config) {
				this.configure(data.config);
			}
			if (this.transmitter && data.bytes) {
				this.transmitter.schedule(data.id, data.bytes);
			}
		}
		this.port.start();
	}

	configure(config) {
		this.config = config;

		this.spacePhaseDelta = 2 * Math.PI * config.space / sampleRate;
		this.markPhaseDelta = 2 * Math.PI * config.mark / sampleRate;
		this.bitSamples = sampleRate / this.config.baud;
	}

	nextSymbol() {
		switch (this.transmitter.nextSymbol()) {
			case 'preamble':
				this.currentSample = 0;
				this.currentPhaseDelta = this.markPhaseDelta;
				this.symbolEnd = this.config.preamble * sampleRate;
				return true;

			case 'space':
				this.currentPhaseDelta = this.spacePhaseDelta;
				this.symbolEnd += this.bitSamples;
				return true;

			case 'mark':
				this.currentPhaseDelta = this.markPhaseDelta;
				this.symbolEnd += this.bitSamples;
				return true;

			case 'tail':
				this.currentPhaseDelta = this.markPhaseDelta;
				this.symbolEnd += this.config.tail * sampleRate;
				return true;

			default:
				/*
				 * Reset phase so after the gap without messages, the next one's signal starts at
				 * zero.
				 */
				this.currentPhase = 0;
				return false;
		}
	}

	process(inputs, outputs, parameters) {
		// If hasn't been initialized yet, return
		if (!this.config) {
			return true;
		}

		// Might happen if called before connecting the output
		if (!outputs || !outputs[0] || !outputs[0][0]) {
			return true;
		}

		const output = outputs[0][0];
		let outputPos = 0;

		while (outputPos < output.length) {
			if (this.currentSample >= this.symbolEnd) {
				// Attempt to fetch next symbol
				if (!this.nextSymbol()) {
					return true;
				}
			}

			// Generate actual sample
			output[outputPos] = Math.sin(this.currentPhase);
			outputPos++;

			// Increment phase, capped at 2pi to reduce precision loss
			this.currentPhase += this.currentPhaseDelta;
			if (this.currentPhase > Math.PI * 2) {
				this.currentPhase -= Math.PI * 2;
			}

			// Step current sample counter
			this.currentSample++;
		}

		return true;
	}
}

registerProcessor('fsk-modulator', FskModulatorProcessor)

class UartReceiver {
	constructor(port) {
		this.port = port;

		this.bytes = new Array();
		this.symbolCount = 0;
		this.symbolBuffer = 0;
	}

	feedBit(bit) {
		// Feed bit into buffer
		this.symbolBuffer = bit << 9 | this.symbolBuffer >> 1;
		this.symbolCount++;

		if (this.symbolCount >= 10) {
			// Check that the start bit is low and stop is high
			if ((this.symbolBuffer & 0x201) == 0x200) {
				/*
				 * If it is, a byte has been successfully received.
				 * Add it to the byte buffer and clear the symbol buffer.
				 */
				this.bytes.push((this.symbolBuffer >> 1) & 0xFF);
				this.symbolCount = 0;
			} else {
				/*
				 * Else, we hit an error condition.
				 *
				 * If the bytes buffer contains anything send it now as is.
				 *
				 * We won't reset the symbol count, as this might happen not only in case of
				 * synchronization loss but also if the message is in the lead-in.
				 */
				if (this.bytes.length > 0) {
					this.port.postMessage(new Uint8Array(this.bytes));
				}
				this.bytes = new Array();
			}
		}
	}

	rxFail() {
		if (this.bytes.length > 0) {
			this.port.postMessage(new Uint8Array(this.bytes));
		}
		this.bytes = new Array();
		this.symbolCount = 0;
	}
}

class FskDemodulatorProcessor extends AudioWorkletProcessor {
	// Experimentally determined to give the best results in noisy environments
	CORR_RATIO = 6 / 8;

	constructor() {
		super();

		this.config = null;
		this.receiver = new UartReceiver(this.port);

		this.port.onmessage = msg => {
			this.configure(msg.data);
		}
		this.port.start();
	}

	configure(config) {
		this.config = config;

		// Delay line, large enough to hold the optimal delay
		const delaySize = Math.round(this.config.rxDelay * sampleRate) - 1;
		this.delay = new Int8Array(delaySize);
		this.delayPos = 0;

		// Instantiate correlator buffer
		const corSize = Math.round(this.CORR_RATIO * sampleRate / this.config.baud);
		this.correlator = new Int8Array(corSize);
		this.corrPos = 0;
		this.corrSum = 0;

		// No bits have been emitted yet
		this.previousBit = null;
		this.emittedBits = 0;
	}

	process(inputs, outputs, parameters) {
		// If hasn't been initialized yet, return
		if (!this.config) {
			return true;
		}

		// Might happen if called before connecting the input
		if (!inputs || !inputs[0] || !inputs[0][0]) {
			return true;
		}

		for (let value of inputs[0][0]) {
			// Calculate the polarity of the current sample
			let curPolarity = value >= 0 ? 1 : -1;

			/*
			 * Multiply with the output of the delay.
			 *
			 * We don't need to special case the start since the buffers are all zero,
			 * so the resulting multiplications will be zero.
			 */
			let newCorrPolarity = this.delay[this.delayPos] * curPolarity;

			// Update the current correlator sum
			let oldCorrPolarity = this.correlator[this.corrPos];
			this.corrSum = this.corrSum - oldCorrPolarity + newCorrPolarity;

			// Overwrite old correlator output
			this.correlator[this.corrPos] = newCorrPolarity;
			this.corrPos = (this.corrPos + 1) % this.correlator.length;

			// Current bit should be inverted if zero frequency is higher than one's
			let currentBit = (this.corrSum >= 0) ^ (this.config.space > this.config.mark);

			if (currentBit == this.previousBit) {
				// Cast to int to floor it
				const previousEmitted = this.emittedBits | 0;
				this.emittedBits += this.config.baud / sampleRate;
				const newEmitted = this.emittedBits | 0;

				// If we have received a new full bit, feed it
				if (previousEmitted != newEmitted) {
					this.receiver.feedBit(currentBit);
				}
			} else {
				/*
				 * If not a single valid bit has been emitted since last polarity change,
				 * the transmission is damaged
				 */
				if (this.emittedBits < 1) {
					this.receiver.rxFail();
				}

				this.previousBit = currentBit;

				// Assume we're in the middle of a valid bit
				this.emittedBits = 0.5;
			}

			// Overwrite old sample in the delay line with the new value
			this.delay[this.delayPos] = curPolarity;
			this.delayPos = (this.delayPos + 1) % this.delay.length;
		}

		return true;
	}
}

registerProcessor('fsk-demodulator', FskDemodulatorProcessor)
