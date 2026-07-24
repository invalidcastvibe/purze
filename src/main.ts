import { createApp } from 'vue';
import App from './App.vue';
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import {
	faCube,
	faWallet,
	faPlus,
	faRotate,
	faCoins,
	faLink,
	faPlug,
	faXmark,
} from '@fortawesome/free-solid-svg-icons';

library.add(faCube, faWallet, faPlus, faRotate, faCoins, faLink, faPlug, faXmark);

const app = createApp(App);
app.component('FontAwesomeIcon', FontAwesomeIcon);
app.mount('#app');
