        // --- Channel Data - Your offline "database" ---
  const feeds = [
  {
    "name": "Mansoor Ali Khan",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UClDtMswg3muouH60XTKlVEw",
    "image": "https://yt3.googleusercontent.com/tNQ2RgaQmLGkOFNgIMhmIibmH43-KniIHoqAnQoe0ozm3V_wDRI7iXBQUGP9wX7FkzE0TaBr=s160-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Dr Shahbaz Gill",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCXQiJKknQM14uQakw0evifw",
    "image": "https://yt3.googleusercontent.com/W-hpUqmJDug1EA-yill-8LDnt8mfSWH9hHYqlHwEfQ6-s5huffopm-N33e86MYe75_EE06ZqWw=s160-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Sami Abraham",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCFCzDl-XQq1TCo_fvBzCoyw",
    "image": "https://yt3.googleusercontent.com/GtRq2c80q7o1bbY-F3SZgHgEgCtOLWdwIFAvd2tcQHi3ReHmmWu233jBbUP2koZndpPJmBNaaQs=s160-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Makhdoom Shahab-ud-Din",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC1yuv89ftFyDQ8Ibre7cRgg",
    "image": "https://yt3.googleusercontent.com/h5gx3Om4z13U11OleTmPMqtcuk9ABaRjnEEwdaon70uQD6mgBAgbxnrFizcwH4IJ86SBabKn_w=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Dr. Moeed Pirzada",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCnkYymEbl1qZ0VhGrzH9guw",
    "image": "https://yt3.googleusercontent.com/ytc/AIdro_kHa4AuV85mqcYiJ9GZ29OFz4dQcwq0i6CITAOlzCfCnw=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Imran Riaz Khan",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCaszgR2TH3qNw_CxLHAd2SQ",
    "image": "https://yt3.googleusercontent.com/KrrtRyGDP6h2wWObxzqPBFqtgxri00qVBYeYrzHQ550S7NJ5Cluy9JkPb2fOD03mqpRdNqP-5Q=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Hamid Mir",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC5N0MlMQopPTGMLUxHISfDg",
    "image": "https://yt3.googleusercontent.com/KAS-YrL67jg_oaC-Nt34C1bdaCnNKWwFRbqm8dib5KGejonnmobDz_Lmmb_ug_KP43kj1DL2jw=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Global Sach ( Dr Nasir Baig )",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC4gwciwDIcmqC0QKaUlAFjA",
    "image": "https://yt3.googleusercontent.com/8M41T9UmDKvmFGsTS9V0oIyerO_MpLGsaM2sTkvHBbco7J5gS4t7iygJAPxTu_4dmpJ2LPWGGpw=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Iqrar Ul Hassan",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC83DMJYvvm9oKeNaFmtay6A",
    "image": "https://yt3.googleusercontent.com/9uySPWFcbNXJK0JkeC96Vta15BO1ra73ciF8fU7bU1gmvek06NZy1BhEBIfY8uqgNvssj9XHMg=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Syed Jawad Naqvi",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC5q41mpGBlCIaXc43iG4qwQ",
    "image": "https://yt3.googleusercontent.com/4ok4VLOTIyXdmk833zyZfluAuD1LpGf3GKL1LCNWeFR1Ink_D-xYOFMZb_B_8x-dqdBnjW8q-Q=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Islamimarkaz live ",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC02xiMIWs6pfKT6G2D8iDlw",
    "image": "https://yt3.googleusercontent.com/4dQ_seNd3MT3kFbbybnx8f-I2o5NGFrR_IdTauKO3JZHSYrEiG5CXDFj5dmORJg3D1dXdqnx=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Elm-ul-Awaleen",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCLzP93YkghWmModgpzDN4JA",
    "image": "https://yt3.googleusercontent.com/wON40vCAJT30CAGHI8Ry5fyocWlePZ8D_ej7UrQykXoQLzSipzR62nwEtgTnf_TRzYVyzCtnUA=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  },
  {
    "name": "Shahat TV",
    "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC76bicuttaSh6VZdioRlHvQ",
    "image": "https://yt3.googleusercontent.com/NlWdeVz4Q7Bmfy6oRyUkAIsKHh6ASMC2ZInqcEttZRtevTVZHVw1iFaXt8YMJVO-2XiL1-qUFak=s900-c-k-c0x00ffffff-no-rj",
    "category": "> Person <"
  }
];
