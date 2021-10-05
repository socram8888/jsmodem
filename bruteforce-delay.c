
#include <stdio.h>
#include <math.h>
#include <stdlib.h>

#ifndef M_PI
#	define M_PI 3.1415926535897932
#endif

int main(int argc, char *argv[]) {
	if (argc != 4) {
		fprintf(stderr, "Usage: %s baud f1 f2\n", argv[0]);
		return 1;
	}

	double baud = atof(argv[1]);
	double f1 = atof(argv[2]);
	double f2 = atof(argv[3]);

	double bestTime = 0;
	double bestDelta = 0;
	for (long double time = 0; time < 1 / baud; time += 1e-11) {
		double curDelta = cos(2 * M_PI * f1 * time) - cos(2 * M_PI * f2 * time);
		if (curDelta < 0) {
			curDelta = -curDelta;
		}
		if (curDelta > bestDelta) {
			bestDelta = curDelta;
			bestTime = time;
		}
	}

	printf("Best delay: %.12f (score: %.12f)\n", bestTime, bestDelta);
	return 0;
}
